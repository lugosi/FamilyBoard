import { NextResponse } from "next/server";
import {
  GOOGLE_CALENDAR_SCOPES,
  createOAuth2,
  requireGoogleOAuthEnv,
} from "@/lib/google";
import { getGoogleRedirectUri } from "@/lib/app-url";

export async function GET(request: Request) {
  try {
    requireGoogleOAuthEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google OAuth not configured" },
      { status: 500 },
    );
  }

  const redirectUri = getGoogleRedirectUri(request);
  const oauth2 = createOAuth2(redirectUri);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    include_granted_scopes: true,
  });
  return NextResponse.redirect(url);
}
