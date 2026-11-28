/**
 * Slack Web API helpers for the FamilyBoard bot (Socket Mode; no public URL needed).
 * Bot token (xoxb-) for chat/users/reactions; app-level token (xapp-, connections:write) for the socket.
 */

const DEFAULT_API_BASE = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 15_000;

export type SlackConfig = {
  botToken: string;
  appToken: string;
};

export function getSlackConfig(): SlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  const appToken = process.env.SLACK_APP_TOKEN?.trim();
  if (!botToken || !appToken) return null;
  return { botToken, appToken };
}

export function isSlackConfigured(): boolean {
  return Boolean(getSlackConfig());
}

function apiBase(): string {
  return (process.env.SLACK_API_BASE_URL?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
}

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

/** Slack returns HTTP 200 with `ok: false` for most failures. */
export async function slackApi<T extends SlackResponse>(
  method: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Slack ${method} unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !json?.ok) {
    throw new Error(`Slack ${method}: ${json?.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Some Slack file methods only accept form-urlencoded bodies. */
async function slackApiForm<T extends SlackResponse>(
  method: string,
  token: string,
  fields: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Slack ${method} unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !json?.ok) {
    throw new Error(`Slack ${method}: ${json?.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

function requireConfig(): SlackConfig {
  const cfg = getSlackConfig();
  if (!cfg) throw new Error("slack_not_configured");
  return cfg;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isSlackFileHost(url: URL): boolean {
  if (url.origin === new URL(apiBase()).origin) return true;
  return (
    url.protocol === "https:" &&
    (url.hostname === "files.slack.com" || url.hostname.endsWith(".slack.com"))
  );
}

/** Download a file shared with the bot (needs the files:read scope). The token is only sent to Slack. */
export async function downloadSlackFile(fileUrl: string): Promise<Buffer> {
  const { botToken } = requireConfig();
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new Error("Bad Slack file URL");
  }
  if (!isSlackFileHost(url)) throw new Error("Refusing to send the Slack token to a non-Slack host");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  // Without files:read Slack returns 403 or an HTML sign-in page instead of the file.
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 403 || contentType.includes("text/html")) {
    throw new Error("missing_files_read_scope");
  }
  if (!res.ok) throw new Error(`Slack file download: HTTP ${res.status}`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_FILE_BYTES) throw new Error("File is larger than 5 MB");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_FILE_BYTES) throw new Error("File is larger than 5 MB");
  return data;
}

export async function slackAuthTest(): Promise<{
  team: string;
  teamId: string;
  botUserId: string;
  botName: string;
}> {
  const { botToken } = requireConfig();
  const res = await slackApi<SlackResponse & {
    team?: string;
    team_id?: string;
    user_id?: string;
    user?: string;
  }>("auth.test", botToken);
  return {
    team: res.team ?? "",
    teamId: res.team_id ?? "",
    botUserId: res.user_id ?? "",
    botName: res.user ?? "",
  };
}

export async function openSlackSocketUrl(): Promise<string> {
  const { appToken } = requireConfig();
  const res = await slackApi<SlackResponse & { url?: string }>("apps.connections.open", appToken);
  if (!res.url) throw new Error("Slack apps.connections.open returned no url");
  return res.url;
}

export type SlackBlock = Record<string, unknown>;

/** Stay under Slack's practical text budget (docs recommend ~4k; hard fails as msg_too_long). */
export const SLACK_SAFE_TEXT_CHARS = 3500;
/** Block Kit section mrkdwn max is 3000. */
export const SLACK_SECTION_TEXT_CHARS = 2900;

const FENCE_CLOSE = "\n```";
const FENCE_OPEN = "```\n";

function hasOpenFence(text: string): boolean {
  return ((text.match(/```/g) ?? []).length) % 2 === 1;
}

/** Last index where a cut would not split a Slack `<url|label>` token. */
function safeTokenCut(text: string, cut: number): number {
  const open = text.lastIndexOf("<", cut - 1);
  if (open < 0 || open < cut - 300 || text.lastIndexOf(">", cut - 1) > open) return cut;
  return open > 0 ? open : cut;
}

/**
 * Split long Slack text on paragraph/line boundaries for thread replies.
 * A code fence cut by a split is closed in that chunk and reopened in the next
 * so each message renders on its own; `<url|label>` tokens are never cut.
 */
export function splitSlackText(text: string, maxChars = SLACK_SAFE_TEXT_CHARS): string[] {
  const raw = text.replace(/\s+$/u, "");
  if (!raw) return [" "];
  if (raw.length <= maxChars) return [raw];

  const chunks: string[] = [];
  const budget = maxChars - FENCE_CLOSE.length;
  let rest = raw;
  while (rest.length > maxChars) {
    const window = rest.slice(0, budget);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (cut < budget * 0.4) cut = window.lastIndexOf(" ");
    if (cut < budget * 0.4) cut = budget;
    cut = safeTokenCut(rest, cut);
    let piece = rest.slice(0, cut).replace(/\s+$/u, "");
    if (!piece) {
      piece = rest.slice(0, budget);
      cut = budget;
    }
    let next = rest.slice(cut).replace(/^\s+/u, "");
    if (hasOpenFence(piece)) {
      piece += FENCE_CLOSE;
      next = FENCE_OPEN + next;
    }
    chunks.push(piece);
    rest = next;
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [" "];
}

/** Clip a single Block Kit section / notification fallback string. */
export function clipSlackText(text: string, maxChars = SLACK_SECTION_TEXT_CHARS): string {
  const t = text.trim() || " ";
  if (t.length <= maxChars) return t;
  let head = t.slice(0, Math.max(0, maxChars - 1));
  if (hasOpenFence(head)) head = head.slice(0, Math.max(0, maxChars - 1 - FENCE_CLOSE.length));
  head = head.slice(0, safeTokenCut(head, head.length));
  return `${head}…${hasOpenFence(head) ? FENCE_CLOSE : ""}`;
}

/** Block Kit Approve / Deny row for a staged calendar/wiki write. */
export function pendingApprovalBlocks(pendingId: string, summary: string): SlackBlock[] {
  const clipped = clipSlackText(summary, 2700);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⏸ *Review before writing*\n\`\`\`${clipped.replace(/```/g, "'''")}\`\`\``,
      },
    },
    {
      type: "actions",
      block_id: `pending_${pendingId}`,
      elements: [
        {
          type: "button",
          action_id: "familyboard_approve",
          style: "primary",
          text: { type: "plain_text", text: "Approve", emoji: true },
          value: pendingId,
        },
        {
          type: "button",
          action_id: "familyboard_deny",
          style: "danger",
          text: { type: "plain_text", text: "Deny", emoji: true },
          value: pendingId,
        },
      ],
    },
  ];
}

/** Member ids are U… (W… on Enterprise Grid). Channel and DM ids are C…, G…, or D…. */
export function slackChannelIsUserId(channel: string): boolean {
  return /^[UW][A-Z0-9]+$/.test(channel.trim());
}

export type SlackMember = { id: string; name: string };

/** Display name, real name, then the Slack handle. Never the raw member id. */
export function slackMemberLabel(user: {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
}): string {
  const id = user.id?.trim() || "";
  const name =
    user.profile?.display_name?.trim() ||
    user.profile?.real_name?.trim() ||
    user.real_name?.trim() ||
    user.name?.trim() ||
    "";
  if (!name || (id && name.toUpperCase() === id.toUpperCase())) return "";
  return name;
}

export function matchSlackMember(members: SlackMember[], userId: string): SlackMember | undefined {
  const want = userId.trim().toUpperCase();
  if (!want) return undefined;
  return members.find((m) => m.id.toUpperCase() === want);
}

type SlackMemberPage = SlackResponse & {
  members?: {
    id?: string;
    name?: string;
    real_name?: string;
    deleted?: boolean;
    is_bot?: boolean;
    profile?: { display_name?: string; real_name?: string };
  }[];
  response_metadata?: { next_cursor?: string };
};

const memberDirectory: { at: number; members: SlackMember[]; error: string } = {
  at: 0,
  members: [],
  error: "",
};

/** Workspace members (users.list). Cached. `error` is set when Slack refuses the list. */
export async function listSlackMembers(): Promise<{ members: SlackMember[]; error?: string }> {
  if (memberDirectory.members.length && Date.now() - memberDirectory.at < 10 * 60_000) {
    return {
      members: memberDirectory.members,
      ...(memberDirectory.error ? { error: memberDirectory.error } : {}),
    };
  }
  const { botToken } = requireConfig();
  const members: SlackMember[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 20; page += 1) {
      const res = await slackApi<SlackMemberPage>("users.list", botToken, {
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const user of res.members ?? []) {
        const id = user.id?.trim();
        if (!id || user.deleted || user.is_bot) continue;
        const name = slackMemberLabel(user);
        if (!name) continue;
        members.push({ id, name });
      }
      cursor = res.response_metadata?.next_cursor?.trim() || "";
      if (!cursor) break;
    }
    memberDirectory.at = Date.now();
    memberDirectory.members = members;
    memberDirectory.error = "";
    return { members };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    memberDirectory.error = error;
    return { members: memberDirectory.members, error };
  }
}

/**
 * Open (or resume) the app’s 1:1 DM and return its D… channel id.
 * chat.postMessage to a U… id lands in the Slackbot DM, not this app.
 */
export async function openSlackDmChannel(userId: string): Promise<string> {
  const { botToken } = requireConfig();
  const res = await slackApi<SlackResponse & { channel?: { id?: string } }>(
    "conversations.open",
    botToken,
    { users: userId, return_im: true },
  );
  const id = res.channel?.id?.trim() ?? "";
  if (!id.startsWith("D")) {
    throw new Error(
      `Slack conversations.open returned ${id || "no channel"} instead of a DM`,
    );
  }
  return id;
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
}): Promise<{ ts: string; channel: string }> {
  const { botToken } = requireConfig();
  let channel = input.channel.trim();
  if (slackChannelIsUserId(channel)) {
    const directory = await listSlackMembers().catch(() => ({ members: [] as SlackMember[] }));
    const member = matchSlackMember(directory.members, channel);
    if (member) channel = member.id;
    channel = await openSlackDmChannel(channel);
  }
  const res = await slackApi<SlackResponse & { ts?: string; channel?: string }>(
    "chat.postMessage",
    botToken,
    {
      channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
      unfurl_links: false,
    },
  );
  if (!res.ts) throw new Error("Slack chat.postMessage returned no ts");
  return { ts: res.ts, channel: res.channel ?? channel };
}

/**
 * Post a (possibly long) reply as one Slack message, then continue in the same thread
 * so we never hit msg_too_long. When already in a thread, all chunks use that thread.
 * When top-level, chunk 2+ reply under the first message's ts.
 */
export async function postSlackText(input: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<{ ts: string; channel: string }> {
  // Dynamic import keeps this file loadable by node:test (extensionless
  // static imports break under Node ESM). Idempotent if caller already rewrote.
  const { markdownForSlack } = await import("./markdown-slack");
  const text = markdownForSlack(input.text);
  const chunks = splitSlackText(text);
  const first = await postSlackMessage({
    channel: input.channel,
    text: chunks[0]!,
    threadTs: input.threadTs,
  });
  const continueTs = input.threadTs || first.ts;
  for (let i = 1; i < chunks.length; i += 1) {
    await postSlackMessage({
      channel: input.channel,
      text: chunks[i]!,
      threadTs: continueTs,
    });
  }
  return first;
}

/**
 * Upload a file (e.g. chart PNG) into a channel/thread via Slack's external upload API.
 * Needs `files:write` on the bot token.
 *
 * Flow: getUploadURLExternal (form) → POST raw bytes → completeUploadExternal.
 */
export async function uploadSlackFile(input: {
  channel: string;
  threadTs?: string;
  filename: string;
  title?: string;
  data: Buffer;
  mimeType?: string;
}): Promise<void> {
  const { botToken } = requireConfig();
  const length = input.data.byteLength;
  if (!length) throw new Error("Slack file upload: empty file");

  // Docs require form-urlencoded for getUploadURLExternal (JSON often returns invalid_arguments).
  const prep = await slackApiForm<
    SlackResponse & { upload_url?: string; file_id?: string }
  >("files.getUploadURLExternal", botToken, {
    filename: input.filename,
    length: String(length),
  });
  if (!prep.upload_url || !prep.file_id) {
    throw new Error("Slack files.getUploadURLExternal missing upload_url/file_id");
  }

  // Raw bytes (not multipart). Do not send Authorization to the upload host.
  const put = await fetch(prep.upload_url, {
    method: "POST",
    body: new Uint8Array(input.data),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!put.ok) {
    const detail = (await put.text().catch(() => "")).slice(0, 120);
    throw new Error(
      `Slack file PUT failed: HTTP ${put.status}${detail ? ` ${detail}` : ""}`,
    );
  }

  await slackApi("files.completeUploadExternal", botToken, {
    files: [
      {
        id: prep.file_id,
        title: input.title || input.filename,
      },
    ],
    channel_id: input.channel,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  });
}

export async function updateSlackMessage(input: {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<void> {
  const { botToken } = requireConfig();
  await slackApi("chat.update", botToken, {
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : { blocks: [] }),
  });
}

export async function setSlackReaction(input: {
  channel: string;
  ts: string;
  name: string;
  on: boolean;
}): Promise<void> {
  const { botToken } = requireConfig();
  await slackApi(input.on ? "reactions.add" : "reactions.remove", botToken, {
    channel: input.channel,
    timestamp: input.ts,
    name: input.name,
  }).catch(() => undefined);
}

const nameCache = new Map<string, { name: string; at: number }>();

export async function getSlackUserName(userId: string): Promise<string | undefined> {
  const key = userId.trim().toUpperCase();
  const cached = nameCache.get(key);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.name;
  try {
    const directory = await listSlackMembers();
    const fromList = matchSlackMember(directory.members, userId)?.name;
    if (fromList) {
      nameCache.set(key, { name: fromList, at: Date.now() });
      return fromList;
    }
  } catch {
    /* fall through to users.info */
  }
  const { botToken } = requireConfig();
  try {
    const res = await slackApi<SlackResponse & {
      user?: { id?: string; name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } };
    }>("users.info", botToken, { user: userId });
    const name = res.user ? slackMemberLabel(res.user) : "";
    if (name) nameCache.set(key, { name, at: Date.now() });
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Slack message text → plain text: drop the bot mention, unwrap links/mentions, decode entities. */
export function slackTextToPlain(text: string, botUserId?: string): string {
  let out = text;
  if (botUserId) out = out.replace(new RegExp(`<@${botUserId}>`, "g"), "");
  return out
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id, label) => (label ? `@${label.slice(1)}` : `@${id}`))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
