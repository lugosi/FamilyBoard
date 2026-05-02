import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
} from "@/lib/spotify";

type RecentTrackItem = {
  played_at?: string;
  track?: {
    id?: string;
    name?: string;
    uri?: string;
    artists?: Array<{ name?: string }>;
    album?: { images?: Array<{ url?: string }> };
  };
};

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
  const limit = Math.max(
    1,
    Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );

  try {
    const out = await spotifyApiFetch<{ items?: RecentTrackItem[] }>(
      `/me/player/recently-played?limit=${limit}`,
    );
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status === 403) {
      return NextResponse.json(
        { error: "Spotify scope missing: user-read-recently-played. Re-link Spotify." },
        { status: 403 },
      );
    }
    if (out.status >= 400) {
      return NextResponse.json(
        { error: "Spotify API request failed", detail: out.data },
        { status: 502 },
      );
    }
    const recent =
      out.data?.items
        ?.map((item) => {
          const track = item.track;
          const id = (track?.id ?? "").trim();
          if (!id) return null;
          return {
            kind: "track" as const,
            id,
            name: track?.name ?? "Unknown track",
            subtitle:
              track?.artists?.map((a) => a.name).filter(Boolean).join(", ") ??
              "Unknown artist",
            imageUrl: track?.album?.images?.[0]?.url,
            uri: track?.uri,
            addedAt: item.played_at ? Date.parse(item.played_at) : Date.now(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)) ?? [];
    return NextResponse.json({ recent });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

