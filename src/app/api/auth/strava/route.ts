import { NextResponse } from "next/server";
import {
  boardAccountKey,
  buildStravaAuthorizeUrl,
  isStravaConfigured,
  parseAccountKey,
  slackAccountKey,
} from "@/lib/strava";

/**
 * Start Strava OAuth for a specific person.
 * Query:
 * - account=board:<member> | slack:<userId>  (or member=maya for board)
 * - name= optional display name
 * - return=/path optional return path after link
 */
export async function GET(request: Request) {
  if (!isStravaConfigured()) {
    return NextResponse.json(
      { error: "Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET" },
      { status: 501 },
    );
  }

  const url = new URL(request.url);
  const rawAccount = url.searchParams.get("account");
  const member = url.searchParams.get("member");
  const slackUser = url.searchParams.get("slack_user");
  const displayName = url.searchParams.get("name")?.trim() || undefined;
  const returnPath = url.searchParams.get("return")?.trim() || "/?tab=ai";

  let accountKey = parseAccountKey(rawAccount);
  try {
    if (!accountKey && member) accountKey = boardAccountKey(member);
    if (!accountKey && slackUser) accountKey = slackAccountKey(slackUser);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid_account" },
      { status: 400 },
    );
  }
  if (!accountKey) {
    return NextResponse.json(
      { error: "Provide account=board:<id>|slack:<id> (or member= / slack_user=)" },
      { status: 400 },
    );
  }

  try {
    const authorizeUrl = buildStravaAuthorizeUrl({
      request,
      accountKey,
      displayName: displayName || accountKey.replace(/^(board|slack):/, ""),
      returnPath,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "strava_oauth_failed" },
      { status: 500 },
    );
  }
}
