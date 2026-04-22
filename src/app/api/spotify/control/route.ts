import { NextResponse } from "next/server";
import {
  readSpotifyTokens,
  requireSpotifyOAuthEnv,
  spotifyApiFetch,
} from "@/lib/spotify";

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

type ControlBody = {
  action?:
    | "play"
    | "pause"
    | "next"
    | "previous"
    | "set_volume"
    | "set_device"
    | "seek"
    | "play_track"
    | "play_context"
    | "queue_track";
  volumePercent?: number;
  deviceId?: string;
  play?: boolean;
  positionMs?: number;
  uri?: string;
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
  let preflightTransfer: { deviceId: string; play: boolean } | null = null;
  let expectedPlayUri: string | null = null;
  let expectedDeviceId: string | null = null;

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
    case "play_track":
      if (!body.uri) {
        return NextResponse.json({ error: "uri is required" }, { status: 400 });
      }
      expectedPlayUri = body.uri;
      expectedDeviceId = body.deviceId ?? null;
      if (body.deviceId) {
        // Make target device active first; many Connect devices ignore direct play until transferred.
        preflightTransfer = { deviceId: body.deviceId, play: true };
      }
      endpoint = `/me/player/play${
        body.deviceId ? `?device_id=${encodeURIComponent(body.deviceId)}` : ""
      }`;
      init.method = "PUT";
      init.body = JSON.stringify({ uris: [body.uri] });
      break;
    case "play_context":
      if (!body.uri) {
        return NextResponse.json({ error: "uri is required" }, { status: 400 });
      }
      expectedPlayUri = body.uri;
      expectedDeviceId = body.deviceId ?? null;
      if (body.deviceId) {
        preflightTransfer = { deviceId: body.deviceId, play: true };
      }
      endpoint = `/me/player/play${
        body.deviceId ? `?device_id=${encodeURIComponent(body.deviceId)}` : ""
      }`;
      init.method = "PUT";
      init.body = JSON.stringify({ context_uri: body.uri });
      break;
    case "queue_track":
      if (!body.uri) {
        return NextResponse.json({ error: "uri is required" }, { status: 400 });
      }
      endpoint = `/me/player/queue?uri=${encodeURIComponent(body.uri)}${
        body.deviceId ? `&device_id=${encodeURIComponent(body.deviceId)}` : ""
      }`;
      init.method = "POST";
      break;
    default:
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    if (preflightTransfer) {
      const transferOut = await spotifyApiFetch("/me/player", {
        method: "PUT",
        body: JSON.stringify({
          device_ids: [preflightTransfer.deviceId],
          play: preflightTransfer.play,
        }),
      });
      if (transferOut.status >= 400) {
        const detailMsg = spotifyDetailMessage(transferOut.data);
        return NextResponse.json(
          {
            error: detailMsg
              ? `Spotify transfer failed: ${detailMsg}`
              : "Spotify transfer failed",
            detail: transferOut.data,
          },
          { status: transferOut.status === 401 ? 401 : 502 },
        );
      }
      // Give Connect a brief moment to switch active device.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const out = await spotifyApiFetch(endpoint, init);
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      const detailMsg = spotifyDetailMessage(out.data);
      return NextResponse.json(
        {
          error: detailMsg
            ? `Spotify control failed: ${detailMsg}`
            : "Spotify control failed",
          detail: out.data,
        },
        { status: 502 },
      );
    }

    if (expectedPlayUri) {
      // Spotify can accept play requests but not start playback immediately.
      // Verify and return a warning so UI can surface actionable guidance.
      let verified = false;
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const probe = await spotifyApiFetch<{
          is_playing?: boolean;
          item?: { uri?: string };
          context?: { uri?: string };
          device?: { id?: string };
        }>("/me/player");
        if (probe.status >= 400 || !probe.data) continue;
        const onExpectedDevice = expectedDeviceId
          ? probe.data.device?.id === expectedDeviceId
          : true;
        if (probe.data.is_playing && onExpectedDevice) {
          verified = true;
          break;
        }
      }
      if (!verified) {
        return NextResponse.json(
          {
            error:
              "Playback did not start. Open Spotify on the target device first, ensure it's active, then try again.",
          },
          { status: 409 },
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "spotify_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
