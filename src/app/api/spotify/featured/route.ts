import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
} from "@/lib/spotify";

type FeaturedPlaylist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: Array<{ url?: string }>;
  owner?: { display_name?: string };
};

type SpotifyUserProfile = {
  country?: string;
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
  return root.error?.message ?? root.error?.reason ?? root.message ?? root.reason ?? null;
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
  const limit = Math.max(
    1,
    Math.min(20, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );
  const country = (url.searchParams.get("country") ?? "").trim().toUpperCase();
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";

  try {
    const requestFeatured = (endpoint: string) =>
      spotifyApiFetch<{
        playlists?: { items?: FeaturedPlaylist[] };
        message?: string;
      }>(endpoint);
    let out = await requestFeatured(
      `/browse/featured-playlists?limit=${limit}&market=from_token${countryParam}`,
    );
    if (out.status === 403) {
      // Some accounts/markets reject `market=from_token` on browse endpoints.
      out = await requestFeatured(`/browse/featured-playlists?limit=${limit}${countryParam}`);
    }
    if (out.status === 403 && !country) {
      // Fallback: resolve account country and retry with explicit country.
      const me = await spotifyApiFetch<SpotifyUserProfile>("/me");
      const profileCountry = (me.data?.country ?? "").trim().toUpperCase();
      if (profileCountry) {
        out = await requestFeatured(
          `/browse/featured-playlists?limit=${limit}&country=${encodeURIComponent(profileCountry)}`,
        );
      }
    }
    if (out.status === 403) {
      // Last fallback: known-safe default country.
      out = await requestFeatured(`/browse/featured-playlists?limit=${limit}&country=US`);
    }
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
      playlists: out.data?.playlists?.items ?? [],
      message: out.data?.message ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
