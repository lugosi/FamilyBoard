import { NextResponse } from "next/server";
import {
  getStravaRedirectUri,
  isStravaConfigured,
  listStravaAccounts,
  parseAccountKey,
  getStravaAccount,
} from "@/lib/strava";

function oauthHints(request: Request) {
  const redirectUri = getStravaRedirectUri(request);
  let callbackDomain = "";
  try {
    callbackDomain = new URL(redirectUri).hostname;
  } catch {
    callbackDomain = "";
  }
  return {
    redirectUri,
    /** Paste this into Strava → My API Application → Authorization Callback Domain (host only). */
    callbackDomain,
  };
}

/** List linked Strava accounts (no tokens), or one account when ?account= is set. */
export async function GET(request: Request) {
  const hints = oauthHints(request);
  if (!isStravaConfigured()) {
    return NextResponse.json({ configured: false, accounts: [], ...hints });
  }
  const account = parseAccountKey(new URL(request.url).searchParams.get("account"));
  if (account) {
    const row = await getStravaAccount(account);
    if (!row) {
      return NextResponse.json({ configured: true, linked: false, account, ...hints });
    }
    return NextResponse.json({
      configured: true,
      linked: true,
      account: {
        accountKey: row.accountKey,
        displayName: row.displayName,
        athleteId: row.athleteId,
        athleteName: row.athleteName,
        updatedAt: row.updatedAt,
      },
      ...hints,
    });
  }
  const accounts = (await listStravaAccounts()).map((row) => ({
    accountKey: row.accountKey,
    displayName: row.displayName,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    updatedAt: row.updatedAt,
  }));
  return NextResponse.json({ configured: true, accounts, ...hints });
}
