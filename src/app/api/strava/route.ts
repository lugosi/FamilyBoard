import { NextResponse } from "next/server";
import {
  isStravaConfigured,
  listStravaAccounts,
  parseAccountKey,
  getStravaAccount,
} from "@/lib/strava";

/** List linked Strava accounts (no tokens), or one account when ?account= is set. */
export async function GET(request: Request) {
  if (!isStravaConfigured()) {
    return NextResponse.json({ configured: false, accounts: [] });
  }
  const account = parseAccountKey(new URL(request.url).searchParams.get("account"));
  if (account) {
    const row = await getStravaAccount(account);
    if (!row) return NextResponse.json({ configured: true, linked: false, account });
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
    });
  }
  const accounts = (await listStravaAccounts()).map((row) => ({
    accountKey: row.accountKey,
    displayName: row.displayName,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    updatedAt: row.updatedAt,
  }));
  return NextResponse.json({ configured: true, accounts });
}
