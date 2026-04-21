import { NextResponse } from "next/server";
import { getAppOrigin, getSpotifyRedirectUri } from "@/lib/app-url";
import { requireSpotifyOAuthEnv, writeSpotifyTokens } from "@/lib/spotify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?spotify_error=${encodeURIComponent(error)}`, getAppOrigin(request)),
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/?spotify_error=missing_code", getAppOrigin(request)),
    );
  }

  const redirectUri = getSpotifyRedirectUri(request);
  try {
    const { clientId, clientSecret } = requireSpotifyOAuthEnv();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "token_exchange_failed");
      return NextResponse.redirect(
        new URL(
          `/?spotify_error=${encodeURIComponent(msg)}`,
          getAppOrigin(request),
        ),
      );
    }

    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    await writeSpotifyTokens({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
      token_type: j.token_type,
      scope: j.scope,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_callback_failed";
    return NextResponse.redirect(
      new URL(`/?spotify_error=${encodeURIComponent(message)}`, getAppOrigin(request)),
    );
  }

  return NextResponse.redirect(new URL("/?spotify=linked", getAppOrigin(request)));
}
