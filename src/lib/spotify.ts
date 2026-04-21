import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";

const TOKEN_FILE = "spotify-tokens.json";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
];

export type StoredSpotifyTokens = {
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
};

export function requireSpotifyOAuthEnv() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export async function readSpotifyTokens(): Promise<StoredSpotifyTokens | null> {
  const file = path.join(getDataDir(), TOKEN_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as StoredSpotifyTokens;
  } catch {
    return null;
  }
}

export async function writeSpotifyTokens(
  incoming: StoredSpotifyTokens,
): Promise<void> {
  const existing = (await readSpotifyTokens()) ?? {};
  const merged: StoredSpotifyTokens = {
    ...existing,
    ...incoming,
    refresh_token:
      incoming.refresh_token ?? existing.refresh_token ?? undefined,
  };
  const file = path.join(getDataDir(), TOKEN_FILE);
  await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf-8");
}

export async function clearSpotifyTokens(): Promise<void> {
  const file = path.join(getDataDir(), TOKEN_FILE);
  try {
    await fs.unlink(file);
  } catch {
    /* noop */
  }
}

function isTokenFresh(token: StoredSpotifyTokens): boolean {
  if (!token.access_token || !token.expires_at) return false;
  return token.expires_at - Date.now() > 60_000;
}

let refreshInFlight: Promise<StoredSpotifyTokens> | null = null;

export async function refreshSpotifyAccessToken(): Promise<StoredSpotifyTokens> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const tokens = await readSpotifyTokens();
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) throw new Error("Spotify account not linked");

    const { clientId, clientSecret } = requireSpotifyOAuthEnv();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`spotify_refresh_failed:${res.status}:${text}`);
    }

    const j = (await res.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
      refresh_token?: string;
    };

    const next: StoredSpotifyTokens = {
      access_token: j.access_token,
      token_type: j.token_type,
      scope: j.scope,
      refresh_token: j.refresh_token ?? refreshToken,
      expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
    };
    await writeSpotifyTokens(next);
    return next;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function getSpotifyAccessToken(): Promise<string> {
  const tokens = await readSpotifyTokens();
  if (!tokens?.refresh_token) throw new Error("Spotify account not linked");
  if (tokens.access_token && isTokenFresh(tokens)) return tokens.access_token;
  const refreshed = await refreshSpotifyAccessToken();
  if (!refreshed.access_token) throw new Error("Spotify access token missing");
  return refreshed.access_token;
}

export async function spotifyApiFetch<T = unknown>(
  endpoint: string,
  init?: RequestInit,
): Promise<{ status: number; data: T | null }> {
  const exec = async (token: string) => {
    const res = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (res.status === 204) return { status: 204, data: null as T | null };
    const text = await res.text().catch(() => "");
    if (!text) return { status: res.status, data: null as T | null };
    try {
      return { status: res.status, data: JSON.parse(text) as T };
    } catch {
      return { status: res.status, data: null as T | null };
    }
  };

  const token = await getSpotifyAccessToken();
  let out = await exec(token);
  if (out.status === 401) {
    const refreshed = await refreshSpotifyAccessToken();
    if (!refreshed.access_token) return out;
    out = await exec(refreshed.access_token);
  }
  return out;
}
