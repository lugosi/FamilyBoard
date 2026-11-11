import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { decodeStravaOAuthState, exchangeStravaCode } from "@/lib/strava";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = decodeStravaOAuthState(url.searchParams.get("state"));
  const origin = getAppOrigin(request);
  const fallbackReturn = "/?tab=ai";

  const safeReturn = (path: string | undefined) => {
    if (!path || !path.startsWith("/") || path.startsWith("//")) return fallbackReturn;
    return path;
  };

  if (error) {
    return NextResponse.redirect(
      new URL(
        `${safeReturn(state?.returnPath)}${safeReturn(state?.returnPath).includes("?") ? "&" : "?"}strava_error=${encodeURIComponent(error)}`,
        origin,
      ),
    );
  }
  if (!code || !state?.accountKey) {
    return NextResponse.redirect(
      new URL(`${fallbackReturn}&strava_error=missing_code_or_state`.replace("?&", "?"), origin),
    );
  }

  try {
    await exchangeStravaCode({
      code,
      accountKey: state.accountKey,
      displayName: state.displayName || state.accountKey.replace(/^(board|slack):/, ""),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "strava_callback_failed";
    const ret = safeReturn(state.returnPath);
    return NextResponse.redirect(
      new URL(
        `${ret}${ret.includes("?") ? "&" : "?"}strava_error=${encodeURIComponent(message)}`,
        origin,
      ),
    );
  }

  const ret = safeReturn(state.returnPath);
  return NextResponse.redirect(
    new URL(`${ret}${ret.includes("?") ? "&" : "?"}strava=linked`, origin),
  );
}
