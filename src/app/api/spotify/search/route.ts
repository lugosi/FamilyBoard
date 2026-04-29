import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
} from "@/lib/spotify";

type SearchTrack = {
  id?: string;
  name?: string;
  uri?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
};

type SearchAlbum = {
  id?: string;
  name?: string;
  uri?: string;
  artists?: Array<{ name?: string }>;
  images?: Array<{ url?: string }>;
};

type SearchPlaylist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: Array<{ url?: string }>;
  owner?: { display_name?: string };
};

function spotifyDetailMessage(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const root = detail as {
    error?: { message?: string; reason?: string; status?: number } | string;
    message?: string;
    reason?: string;
  };
  if (typeof root.error === "string") return root.error;
  if (root.error?.reason && root.error?.message) {
    return `${root.error.message} (${root.error.reason})`;
  }
  return (
    root.error?.message ??
    root.error?.reason ??
    root.message ??
    root.reason ??
    null
  );
}

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.max(
    1,
    Math.min(10, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10),
  );
  if (!q) {
    return NextResponse.json({ tracks: [], albums: [], playlists: [] });
  }

  try {
    const endpoint = `/search?q=${encodeURIComponent(q)}&type=track,album,playlist&limit=${limit}&market=from_token`;
    const out = await spotifyApiFetch<{
      tracks?: { items?: SearchTrack[] };
      albums?: { items?: SearchAlbum[] };
      playlists?: { items?: SearchPlaylist[] };
    }>(endpoint);
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      const detailMsg = spotifyDetailMessage(out.data);
      return NextResponse.json(
        {
          error: detailMsg
            ? `Spotify API request failed: ${detailMsg}`
            : "Spotify API request failed",
          detail: out.data,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      tracks: out.data?.tracks?.items ?? [],
      albums: out.data?.albums?.items ?? [],
      playlists: out.data?.playlists?.items ?? [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
