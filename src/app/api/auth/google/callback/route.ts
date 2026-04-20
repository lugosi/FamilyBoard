import { NextResponse } from "next/server";
import { getAppOrigin, getGoogleRedirectUri } from "@/lib/app-url";
import { createOAuth2, writeGoogleTokens } from "@/lib/google";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(error)}`, getAppOrigin(request)),
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/?google_error=missing_code", getAppOrigin(request)),
    );
  }

  const redirectUri = getGoogleRedirectUri(request);
  const oauth2 = createOAuth2(redirectUri);

  try {
    const { tokens } = await oauth2.getToken(code);
    await writeGoogleTokens({
      refresh_token: tokens.refresh_token ?? undefined,
      access_token: tokens.access_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(message)}`, getAppOrigin(request)),
    );
  }

  return NextResponse.redirect(new URL("/?google=linked", getAppOrigin(request)));
}
