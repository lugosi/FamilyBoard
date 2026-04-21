import { NextResponse } from "next/server";
import { getSpotifyRedirectUri } from "@/lib/app-url";
import { SPOTIFY_SCOPES, requireSpotifyOAuthEnv } from "@/lib/spotify";

export async function GET(request: Request) {
  try {
    const { clientId } = requireSpotifyOAuthEnv();
    const redirectUri = getSpotifyRedirectUri(request);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES.join(" "),
      show_dialog: "true",
    });
    return NextResponse.redirect(
      `https://accounts.spotify.com/authorize?${params.toString()}`,
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Spotify OAuth not configured" },
      { status: 500 },
    );
  }
}
