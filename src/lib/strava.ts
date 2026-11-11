import fs from "fs/promises";
import path from "path";
import { getConfiguredPublicAppUrl } from "./app-url";
import { getDataDir } from "./data-dir";

const STORE_FILE = "strava-accounts.json";
const STRAVA_AUTH = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";

/** Read-only athlete + activity access (per-user). */
export const STRAVA_SCOPES = ["read", "activity:read_all", "profile:read_all"] as const;

export type StravaAccountKey = `slack:${string}` | `board:${string}`;

export type StravaStoredAccount = {
  accountKey: StravaAccountKey;
  displayName: string;
  athleteId?: number;
  athleteName?: string;
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
  scope?: string;
  updatedAt: number;
};

type Store = { accounts: Record<string, StravaStoredAccount> };

export function isStravaConfigured(): boolean {
  return Boolean(
    process.env.STRAVA_CLIENT_ID?.trim() && process.env.STRAVA_CLIENT_SECRET?.trim(),
  );
}

export function requireStravaOAuthEnv() {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export function normalizeBoardMemberId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function boardAccountKey(memberId: string): StravaAccountKey {
  const id = normalizeBoardMemberId(memberId);
  if (!id) throw new Error("member_required");
  return `board:${id}`;
}

export function slackAccountKey(slackUserId: string): StravaAccountKey {
  const id = slackUserId.trim();
  if (!id) throw new Error("slack_user_required");
  return `slack:${id}`;
}

export function parseAccountKey(raw: string | null | undefined): StravaAccountKey | null {
  if (!raw || typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.startsWith("slack:") && v.length > 6) return v as StravaAccountKey;
  if (v.startsWith("board:") && v.length > 6) {
    const id = normalizeBoardMemberId(v.slice(6));
    return id ? (`board:${id}` as StravaAccountKey) : null;
  }
  return null;
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), STORE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed?.accounts || typeof parsed.accounts !== "object") return { accounts: {} };
    return { accounts: parsed.accounts };
  } catch {
    return { accounts: {} };
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), STORE_FILE),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

export async function listStravaAccounts(): Promise<StravaStoredAccount[]> {
  const store = await readStore();
  return Object.values(store.accounts).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getStravaAccount(
  accountKey: StravaAccountKey,
): Promise<StravaStoredAccount | null> {
  const store = await readStore();
  return store.accounts[accountKey] ?? null;
}

export async function upsertStravaAccount(
  account: StravaStoredAccount,
): Promise<StravaStoredAccount> {
  const store = await readStore();
  const prev = store.accounts[account.accountKey];
  const merged: StravaStoredAccount = {
    ...prev,
    ...account,
    refresh_token: account.refresh_token || prev?.refresh_token || "",
    updatedAt: Date.now(),
  };
  if (!merged.refresh_token) throw new Error("strava_refresh_missing");
  store.accounts[account.accountKey] = merged;
  await writeStore(store);
  return merged;
}

export async function clearStravaAccount(accountKey: StravaAccountKey): Promise<boolean> {
  const store = await readStore();
  if (!store.accounts[accountKey]) return false;
  delete store.accounts[accountKey];
  await writeStore(store);
  return true;
}

function isFresh(account: StravaStoredAccount): boolean {
  return Boolean(account.access_token && account.expires_at && account.expires_at - Date.now() > 60_000);
}

const refreshLocks = new Map<string, Promise<StravaStoredAccount>>();

export async function getStravaAccessToken(accountKey: StravaAccountKey): Promise<string> {
  const account = await getStravaAccount(accountKey);
  if (!account?.refresh_token) throw new Error("strava_not_linked");
  if (isFresh(account) && account.access_token) return account.access_token;

  const existing = refreshLocks.get(accountKey);
  if (existing) return (await existing).access_token!;

  const job = (async () => {
    const { clientId, clientSecret } = requireStravaOAuthEnv();
    const res = await fetch(STRAVA_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`strava_refresh_failed:${res.status}:${text.slice(0, 120)}`);
    }
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
    };
    const expiresAt =
      typeof j.expires_at === "number"
        ? j.expires_at * 1000
        : Date.now() + (j.expires_in ?? 3600) * 1000;
    return upsertStravaAccount({
      ...account,
      access_token: j.access_token,
      refresh_token: j.refresh_token || account.refresh_token,
      expires_at: expiresAt,
    });
  })();

  refreshLocks.set(accountKey, job);
  try {
    return (await job).access_token!;
  } finally {
    refreshLocks.delete(accountKey);
  }
}

export async function exchangeStravaCode(input: {
  code: string;
  accountKey: StravaAccountKey;
  displayName: string;
}): Promise<StravaStoredAccount> {
  const { clientId, clientSecret } = requireStravaOAuthEnv();
  const res = await fetch(STRAVA_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`strava_token_exchange_failed:${res.status}:${text.slice(0, 160)}`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in?: number;
    athlete?: { id?: number; firstname?: string; lastname?: string; username?: string };
  };
  const athleteName = [j.athlete?.firstname, j.athlete?.lastname].filter(Boolean).join(" ").trim();
  const expiresAt =
    typeof j.expires_at === "number"
      ? j.expires_at * 1000
      : Date.now() + (j.expires_in ?? 3600) * 1000;
  return upsertStravaAccount({
    accountKey: input.accountKey,
    displayName: input.displayName || athleteName || input.accountKey,
    athleteId: j.athlete?.id,
    athleteName: athleteName || j.athlete?.username,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: expiresAt,
    scope: STRAVA_SCOPES.join(","),
    updatedAt: Date.now(),
  });
}

export type StravaOAuthState = {
  accountKey: StravaAccountKey;
  displayName?: string;
  returnPath?: string;
};

export function encodeStravaOAuthState(state: StravaOAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeStravaOAuthState(raw: string | null): StravaOAuthState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StravaOAuthState;
    const key = parseAccountKey(parsed.accountKey);
    if (!key) return null;
    return {
      accountKey: key,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      returnPath: typeof parsed.returnPath === "string" ? parsed.returnPath : undefined,
    };
  } catch {
    return null;
  }
}

export function getStravaRedirectUri(request?: Request): string {
  const base =
    getConfiguredPublicAppUrl() ||
    (request ? new URL(request.url).origin : null) ||
    `http://localhost:${process.env.APP_PORT || process.env.PORT || "3000"}`;
  return `${base.replace(/\/$/, "")}/api/auth/strava/callback`;
}

export function buildStravaAuthorizeUrl(input: {
  request?: Request;
  accountKey: StravaAccountKey;
  displayName?: string;
  returnPath?: string;
}): string {
  const { clientId } = requireStravaOAuthEnv();
  const redirectUri = getStravaRedirectUri(input.request);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES.join(","),
    state: encodeStravaOAuthState({
      accountKey: input.accountKey,
      displayName: input.displayName,
      returnPath: input.returnPath,
    }),
  });
  return `${STRAVA_AUTH}?${params.toString()}`;
}

export async function stravaApiFetch(
  accountKey: StravaAccountKey,
  pathName: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getStravaAccessToken(accountKey);
  const url = pathName.startsWith("http") ? pathName : `${STRAVA_API}${pathName}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function fetchStravaAthlete(accountKey: StravaAccountKey) {
  const res = await stravaApiFetch(accountKey, "/athlete");
  if (!res.ok) throw new Error(`strava_athlete_failed:${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function listStravaActivities(
  accountKey: StravaAccountKey,
  opts: { page?: number; perPage?: number; after?: number; before?: number } = {},
) {
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    per_page: String(Math.min(opts.perPage ?? 10, 30)),
  });
  if (typeof opts.after === "number") params.set("after", String(opts.after));
  if (typeof opts.before === "number") params.set("before", String(opts.before));
  const res = await stravaApiFetch(accountKey, `/athlete/activities?${params}`);
  if (!res.ok) throw new Error(`strava_activities_failed:${res.status}`);
  return (await res.json()) as Record<string, unknown>[];
}
