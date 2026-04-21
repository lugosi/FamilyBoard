import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
} from "@/lib/spotify";

type ControlBody = {
  action?:
    | "play"
    | "pause"
    | "next"
    | "previous"
    | "set_volume"
    | "set_device"
    | "seek";
  volumePercent?: number;
  deviceId?: string;
  play?: boolean;
  positionMs?: number;
};

export async function POST(request: Request) {
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

  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  let endpoint = "";
  const init: RequestInit = { method: "PUT" };

  switch (body.action) {
    case "play":
      endpoint = "/me/player/play";
      init.method = "PUT";
      break;
    case "pause":
      endpoint = "/me/player/pause";
      init.method = "PUT";
      break;
    case "next":
      endpoint = "/me/player/next";
      init.method = "POST";
      break;
    case "previous":
      endpoint = "/me/player/previous";
      init.method = "POST";
      break;
    case "set_volume": {
      const v = Math.round(Number(body.volumePercent));
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return NextResponse.json(
          { error: "volumePercent must be 0..100" },
          { status: 400 },
        );
      }
      endpoint = `/me/player/volume?volume_percent=${v}`;
      init.method = "PUT";
      break;
    }
    case "set_device":
      if (!body.deviceId) {
        return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
      }
      endpoint = "/me/player";
      init.method = "PUT";
      init.body = JSON.stringify({
        device_ids: [body.deviceId],
        play: body.play ?? false,
      });
      break;
    case "seek": {
      const p = Math.round(Number(body.positionMs));
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json(
          { error: "positionMs must be >= 0" },
          { status: 400 },
        );
      }
      endpoint = `/me/player/seek?position_ms=${p}`;
      init.method = "PUT";
      break;
    }
    default:
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const out = await spotifyApiFetch(endpoint, init);
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      return NextResponse.json(
        { error: "Spotify control failed", detail: out.data },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
