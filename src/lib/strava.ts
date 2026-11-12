import fs from "fs/promises";
import path from "path";
import { getConfiguredPublicAppUrl } from "./app-url";
import { getDataDir } from "./data-dir";

const STORE_FILE = "strava-accounts.json";
const STRAVA_AUTH = "https://www.strava.com/oauth/authorize";
/** Official token endpoint (form-urlencoded). /oauth/token also works; v3 is what the docs show. */
const STRAVA_TOKEN = "https://www.strava.com/api/v3/oauth/token";
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
  await clearStravaActivityCache(accountKey);
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`strava_refresh_failed:${res.status}:${summarizeStravaError(text)}`);
    }
    const j = (await parseStravaTokenJson(res)) as {
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

function summarizeStravaError(text: string): string {
  const trimmed = text.trim();
  if (/request blocked/i.test(trimmed) || /^blocked$/i.test(trimmed)) {
    return "blocked (Strava/CloudFront rejected the token request from this server — retry; if it persists, Strava may be blocking the outbound IP)";
  }
  try {
    const j = JSON.parse(trimmed) as { message?: string; errors?: unknown };
    if (j.message) return j.message.slice(0, 160);
  } catch {
    /* not JSON */
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 160);
}

async function parseStravaTokenJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`strava_token_non_json:${summarizeStravaError(text)}`);
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`strava_token_exchange_failed:${res.status}:${summarizeStravaError(text)}`);
  }
  const j = (await parseStravaTokenJson(res)) as {
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

/** Rolling window for local activity cache / training summaries. */
export const STRAVA_CACHE_WINDOW_DAYS = 30;
const ACTIVITY_CACHE_FILE = "strava-activity-cache.json";
const MAX_SYNC_PAGES = 20;

export type CachedStravaActivity = {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  start_date: string;
  start_date_local: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  total_elevation_gain_m?: number;
  average_speed_mps?: number;
  max_speed_mps?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
};

type AccountActivityCache = {
  accountKey: StravaAccountKey;
  bootstrapped: boolean;
  lastSyncedAt: number;
  /** Exclusive lower bound (unix seconds) for the next incremental list call. */
  afterUnix: number;
  windowStartUnix: number;
  activities: Record<string, CachedStravaActivity>;
};

type ActivityCacheStore = { accounts: Record<string, AccountActivityCache> };

export type StravaSyncResult = {
  mode: "bootstrap" | "diff";
  windowDays: number;
  fetched: number;
  upserted: number;
  pruned: number;
  total: number;
  afterUnix: number;
  lastSyncedAt: number;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strField(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function activityStartUnix(a: CachedStravaActivity): number {
  const ms = Date.parse(a.start_date);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function mapApiActivity(row: Record<string, unknown>): CachedStravaActivity | null {
  const id = num(row.id);
  if (id == null) return null;
  const startDate = strField(row.start_date) ?? "";
  if (!startDate) return null;
  return {
    id,
    name: strField(row.name) ?? "(untitled)",
    type: strField(row.type),
    sport_type: strField(row.sport_type),
    start_date: startDate,
    start_date_local: strField(row.start_date_local) ?? startDate,
    distance_m: num(row.distance) ?? 0,
    moving_time_s: num(row.moving_time) ?? 0,
    elapsed_time_s: num(row.elapsed_time) ?? 0,
    total_elevation_gain_m: num(row.total_elevation_gain),
    average_speed_mps: num(row.average_speed),
    max_speed_mps: num(row.max_speed),
    average_heartrate: num(row.average_heartrate),
    max_heartrate: num(row.max_heartrate),
    suffer_score: num(row.suffer_score),
  };
}

async function readActivityCacheStore(): Promise<ActivityCacheStore> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), ACTIVITY_CACHE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as ActivityCacheStore;
    if (!parsed?.accounts || typeof parsed.accounts !== "object") return { accounts: {} };
    return { accounts: parsed.accounts };
  } catch {
    return { accounts: {} };
  }
}

async function writeActivityCacheStore(store: ActivityCacheStore): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), ACTIVITY_CACHE_FILE),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

function emptyAccountCache(accountKey: StravaAccountKey, windowStartUnix: number): AccountActivityCache {
  return {
    accountKey,
    bootstrapped: false,
    lastSyncedAt: 0,
    afterUnix: windowStartUnix,
    windowStartUnix,
    activities: {},
  };
}

export async function clearStravaActivityCache(accountKey: StravaAccountKey): Promise<void> {
  const store = await readActivityCacheStore();
  if (!store.accounts[accountKey]) return;
  delete store.accounts[accountKey];
  await writeActivityCacheStore(store);
}

/**
 * First call for an account pulls the last 30 days; later calls only fetch
 * activities with start_date after the stored watermark, then prune older than 30 days.
 */
export async function syncStravaActivityCache(
  accountKey: StravaAccountKey,
): Promise<StravaSyncResult> {
  const nowMs = Date.now();
  const windowStartUnix = Math.floor((nowMs - STRAVA_CACHE_WINDOW_DAYS * 86_400_000) / 1000);
  const store = await readActivityCacheStore();
  const prev = store.accounts[accountKey] ?? emptyAccountCache(accountKey, windowStartUnix);
  const mode: "bootstrap" | "diff" = prev.bootstrapped ? "diff" : "bootstrap";
  const after =
    mode === "bootstrap"
      ? windowStartUnix
      : Math.max(prev.afterUnix, windowStartUnix);

  const fetchedRows: CachedStravaActivity[] = [];
  for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
    const rows = await listStravaActivities(accountKey, {
      page,
      perPage: 30,
      after,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const mapped = mapApiActivity(row);
      if (mapped) fetchedRows.push(mapped);
    }
    if (rows.length < 30) break;
  }

  const activities: Record<string, CachedStravaActivity> = { ...prev.activities };
  let upserted = 0;
  for (const a of fetchedRows) {
    const key = String(a.id);
    const before = activities[key];
    if (
      !before ||
      before.start_date !== a.start_date ||
      before.distance_m !== a.distance_m ||
      before.moving_time_s !== a.moving_time_s ||
      before.name !== a.name
    ) {
      upserted += 1;
    }
    activities[key] = a;
  }

  let pruned = 0;
  for (const [key, a] of Object.entries(activities)) {
    if (activityStartUnix(a) < windowStartUnix) {
      delete activities[key];
      pruned += 1;
    }
  }

  let afterUnix = after;
  for (const a of Object.values(activities)) {
    afterUnix = Math.max(afterUnix, activityStartUnix(a));
  }
  // Keep watermark moving even with an empty window so we don't re-bootstrap forever.
  if (Object.keys(activities).length === 0) {
    afterUnix = Math.max(afterUnix, Math.floor(nowMs / 1000));
  }

  const next: AccountActivityCache = {
    accountKey,
    bootstrapped: true,
    lastSyncedAt: nowMs,
    afterUnix,
    windowStartUnix,
    activities,
  };
  store.accounts[accountKey] = next;
  await writeActivityCacheStore(store);

  return {
    mode,
    windowDays: STRAVA_CACHE_WINDOW_DAYS,
    fetched: fetchedRows.length,
    upserted,
    pruned,
    total: Object.keys(activities).length,
    afterUnix,
    lastSyncedAt: nowMs,
  };
}

export async function listCachedStravaActivities(
  accountKey: StravaAccountKey,
  opts: { limit?: number } = {},
): Promise<CachedStravaActivity[]> {
  const store = await readActivityCacheStore();
  const cache = store.accounts[accountKey];
  if (!cache) return [];
  const rows = Object.values(cache.activities).sort(
    (a, b) => activityStartUnix(b) - activityStartUnix(a),
  );
  const limit = opts.limit != null ? Math.max(1, Math.min(opts.limit, 100)) : undefined;
  return limit != null ? rows.slice(0, limit) : rows;
}

export type StravaSportBucket = {
  sport: string;
  count: number;
  distance_m: number;
  moving_time_s: number;
  elevation_m: number;
};

export type StravaTrainingSummary = {
  windowDays: number;
  activityCount: number;
  totals: {
    distance_m: number;
    moving_time_s: number;
    elevation_m: number;
  };
  bySport: StravaSportBucket[];
  recent: Array<{
    id: number;
    name: string;
    sport: string;
    start_date_local: string;
    distance_m: number;
    moving_time_s: number;
  }>;
};

export function summarizeStravaActivities(
  activities: CachedStravaActivity[],
  opts: { recentLimit?: number } = {},
): StravaTrainingSummary {
  const bySportMap = new Map<string, StravaSportBucket>();
  let distance = 0;
  let moving = 0;
  let elevation = 0;
  for (const a of activities) {
    distance += a.distance_m || 0;
    moving += a.moving_time_s || 0;
    elevation += a.total_elevation_gain_m || 0;
    const sport = a.sport_type || a.type || "Other";
    const bucket = bySportMap.get(sport) ?? {
      sport,
      count: 0,
      distance_m: 0,
      moving_time_s: 0,
      elevation_m: 0,
    };
    bucket.count += 1;
    bucket.distance_m += a.distance_m || 0;
    bucket.moving_time_s += a.moving_time_s || 0;
    bucket.elevation_m += a.total_elevation_gain_m || 0;
    bySportMap.set(sport, bucket);
  }
  const sorted = [...activities].sort((a, b) => activityStartUnix(b) - activityStartUnix(a));
  const recentLimit = Math.max(1, Math.min(opts.recentLimit ?? 5, 20));
  return {
    windowDays: STRAVA_CACHE_WINDOW_DAYS,
    activityCount: activities.length,
    totals: {
      distance_m: Math.round(distance),
      moving_time_s: moving,
      elevation_m: Math.round(elevation),
    },
    bySport: [...bySportMap.values()].sort((a, b) => b.distance_m - a.distance_m),
    recent: sorted.slice(0, recentLimit).map((a) => ({
      id: a.id,
      name: a.name,
      sport: a.sport_type || a.type || "Other",
      start_date_local: a.start_date_local,
      distance_m: a.distance_m,
      moving_time_s: a.moving_time_s,
    })),
  };
}
