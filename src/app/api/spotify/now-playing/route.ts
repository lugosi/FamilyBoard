import { NextResponse } from "next/server";
import {
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
  type StoredSpotifyTokens,
  readSpotifyTokens,
} from "@/lib/spotify";

function ensureConfigured() {
  try {
    requireSpotifyOAuthEnv();
    return true;
  } catch {
    return false;
  }
}

function isLinked(tokens: StoredSpotifyTokens | null): boolean {
  return Boolean(tokens?.refresh_token);
}

export async function GET() {
  if (!ensureConfigured()) {
    return NextResponse.json(
      { error: "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET" },
      { status: 501 },
    );
  }
  if (!isLinked(await readSpotifyTokens())) {
    return NextResponse.json({ error: "Spotify account not linked" }, { status: 401 });
  }

  try {
    const out = await spotifyApiFetch<{
      is_playing?: boolean;
      progress_ms?: number;
      shuffle_state?: boolean;
      repeat_state?: string;
      item?: {
        id?: string;
        name?: string;
        duration_ms?: number;
        album?: { images?: Array<{ url?: string }>; name?: string };
        artists?: Array<{ name?: string }>;
      };
      device?: {
        id?: string;
        name?: string;
        is_active?: boolean;
        type?: string;
        volume_percent?: number;
      };
    }>("/me/player");

    if (out.status === 204) {
      return NextResponse.json({ playback: null });
    }
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      return NextResponse.json(
        { error: "Spotify API request failed", detail: out.data },
        { status: 502 },
      );
    }
    return NextResponse.json({ playback: out.data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
