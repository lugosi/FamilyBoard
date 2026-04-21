import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
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
    const out = await spotifyApiFetch<{
      devices?: Array<{
        id?: string;
        is_active?: boolean;
        is_restricted?: boolean;
        name?: string;
        type?: string;
        volume_percent?: number;
      }>;
    }>("/me/player/devices");
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      return NextResponse.json(
        { error: "Spotify API request failed", detail: out.data },
        { status: 502 },
      );
    }
    return NextResponse.json({ devices: out.data?.devices ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
