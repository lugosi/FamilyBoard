import { NextResponse } from "next/server";
import {
  getSpotifyAccessToken,
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
} from "@/lib/spotify";

export async function GET() {
  try {
    requireSpotifyOAuthEnv();
  } catch {
    return NextResponse.json(
      { error: "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET" },
      { status: 501 },
    );
  }
  const tokens = await readSpotifyTokens();
  if (!tokens?.refresh_token) {
    return NextResponse.json({ error: "Spotify account not linked" }, { status: 401 });
  }

  try {
    const accessToken = await getSpotifyAccessToken();
    return NextResponse.json({ accessToken });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_token_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
