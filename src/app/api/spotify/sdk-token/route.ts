import { NextResponse } from "next/server";
import { getSpotifyAccessToken, readSpotifyTokens, requireSpotifyOAuthEnv } from "@/lib/spotify";

export async function GET() {
  try {
    requireSpotifyOAuthEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Spotify OAuth not configured" },
      { status: 501 },
    );
  }

  const stored = await readSpotifyTokens();
  if (!stored?.refresh_token) {
    return NextResponse.json({ error: "Spotify account not linked" }, { status: 401 });
  }

  try {
    const accessToken = await getSpotifyAccessToken();
    return NextResponse.json({ accessToken });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch Spotify access token" },
      { status: 500 },
    );
  }
}
