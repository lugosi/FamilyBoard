import { NextResponse } from "next/server";
import { clearStravaAccount, parseAccountKey } from "@/lib/strava";

export async function POST(request: Request) {
  let account: string | null = null;
  try {
    const body = (await request.json()) as { account?: string };
    account = body.account ?? null;
  } catch {
    /* empty */
  }
  const key = parseAccountKey(account);
  if (!key) {
    return NextResponse.json({ error: "account required" }, { status: 400 });
  }
  const ok = await clearStravaAccount(key);
  return NextResponse.json({ ok });
}
