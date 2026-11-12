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

/** Block Kit Approve / Deny row for a staged calendar/wiki write. */
export function pendingApprovalBlocks(pendingId: string, summary: string): SlackBlock[] {
  const clipped = summary.length > 2800 ? `${summary.slice(0, 2790)}…` : summary;
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

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
}): Promise<{ ts: string; channel: string }> {
  const { botToken } = requireConfig();
  const res = await slackApi<SlackResponse & { ts?: string; channel?: string }>(
    "chat.postMessage",
    botToken,
    {
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
      unfurl_links: false,
    },
  );
  if (!res.ts) throw new Error("Slack chat.postMessage returned no ts");
  return { ts: res.ts, channel: res.channel ?? input.channel };
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
  const cached = nameCache.get(userId);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.name;
  const { botToken } = requireConfig();
  try {
    const res = await slackApi<SlackResponse & {
      user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } };
    }>("users.info", botToken, { user: userId });
    const name =
      res.user?.profile?.display_name?.trim() ||
      res.user?.profile?.real_name?.trim() ||
      res.user?.real_name?.trim();
    if (name) nameCache.set(userId, { name, at: Date.now() });
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
