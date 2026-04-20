import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { getDataDir } from "./data-dir";

const TOKEN_FILE = "google-tokens.json";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export type StoredGoogleTokens = {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
};

export function requireGoogleOAuthEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export async function readGoogleTokens(): Promise<StoredGoogleTokens | null> {
  const file = path.join(getDataDir(), TOKEN_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as StoredGoogleTokens;
  } catch {
    return null;
  }
}

export async function writeGoogleTokens(
  incoming: StoredGoogleTokens,
): Promise<void> {
  const existing = (await readGoogleTokens()) ?? {};
  const merged: StoredGoogleTokens = {
    ...existing,
    ...incoming,
    refresh_token:
      incoming.refresh_token ?? existing.refresh_token ?? undefined,
  };
  const file = path.join(getDataDir(), TOKEN_FILE);
  await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf-8");
}

export async function clearGoogleTokens(): Promise<void> {
  const file = path.join(getDataDir(), TOKEN_FILE);
  try {
    await fs.unlink(file);
  } catch {
    /* noop */
  }
}

export function createOAuth2(redirectUri: string) {
  const { clientId, clientSecret } = requireGoogleOAuthEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getOAuth2WithRefresh(redirectUri: string) {
  const tokens = await readGoogleTokens();
  if (!tokens?.refresh_token) {
    throw new Error("Google account not linked");
  }
  const oauth2 = createOAuth2(redirectUri);
  oauth2.setCredentials({ refresh_token: tokens.refresh_token });
  return oauth2;
}

export function getCalendarClient(auth: ReturnType<typeof createOAuth2>) {
  return google.calendar({ version: "v3", auth });
}

export function getDefaultCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
}

export function getDefaultTimeZone(): string {
  return process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
}
