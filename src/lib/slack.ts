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

function requireConfig(): SlackConfig {
  const cfg = getSlackConfig();
  if (!cfg) throw new Error("slack_not_configured");
  return cfg;
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

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<void> {
  const { botToken } = requireConfig();
  await slackApi("chat.postMessage", botToken, {
    channel: input.channel,
    text: input.text,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    unfurl_links: false,
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
