import { NextResponse } from "next/server";
import { readSpotifyTokens, requireSpotifyOAuthEnv, spotifyApiFetch } from "@/lib/spotify";

export const runtime = "nodejs";

type Device = {
  id?: string;
  is_active?: boolean;
  is_restricted?: boolean;
  name?: string;
  type?: string;
};

type Body = {
  deviceNameHint?: string;
  excludeDeviceId?: string;
  excludeDeviceIds?: string[];
  baselineDeviceIds?: string[];
  timeoutMs?: number;
  startPlayback?: boolean;
};

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function pickDevice(
  devices: Device[],
  nameHint: string,
  excludeDeviceIds: Set<string>,
  baselineDeviceIds: Set<string>,
): Device | null {
  const candidates = devices.filter(
    (d) => d.id && !d.is_restricted && !excludeDeviceIds.has(d.id),
  );
  if (candidates.length === 0) return null;

  const hint = normalizeName(nameHint);
  if (hint) {
    const byName = candidates.find((d) => {
      const n = normalizeName(d.name);
      return Boolean(n) && (n.includes(hint) || hint.includes(n));
    });
    if (byName) return byName;
  }

  const newlyAppeared = candidates.find((d) => d.id && !baselineDeviceIds.has(d.id));
  if (newlyAppeared) return newlyAppeared;

  return null;
}

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const timeoutMs = Math.max(5000, Math.min(90000, Math.round(Number(body.timeoutMs ?? 60000))));
  const pollMs = 2000;
  const iterations = Math.max(1, Math.floor(timeoutMs / pollMs));
  const nameHint = (body.deviceNameHint ?? "").trim();
  const excludeDeviceIds = new Set<string>();
  if (body.excludeDeviceId?.trim()) excludeDeviceIds.add(body.excludeDeviceId.trim());
  for (const id of body.excludeDeviceIds ?? []) {
    if (typeof id === "string" && id.trim()) excludeDeviceIds.add(id.trim());
  }
  const baselineDeviceIds = new Set<string>();
  for (const id of body.baselineDeviceIds ?? []) {
    if (typeof id === "string" && id.trim()) baselineDeviceIds.add(id.trim());
  }
  const startPlayback = Boolean(body.startPlayback ?? true);

  let visibleNames: string[] = [];
  let picked: Device | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const out = await spotifyApiFetch<{ devices?: Device[] }>("/me/player/devices");
    if (out.status === 401) {
      return NextResponse.json({ error: "Spotify link expired" }, { status: 401 });
    }
    if (out.status >= 400) {
      return NextResponse.json(
        { error: "Spotify API request failed", detail: out.data },
        { status: 502 },
      );
    }
    const devices = out.data?.devices ?? [];
    visibleNames = devices
      .filter((d) => d.id)
      .map((d) => d.name || d.id || "unknown")
      .slice(0, 10);
    picked = pickDevice(devices, nameHint, excludeDeviceIds, baselineDeviceIds);
    if (picked?.id) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (!picked?.id) {
    return NextResponse.json(
      {
        ok: false,
        status: "cast_launched_spotify_not_exposed",
        visibleDevices: visibleNames,
      },
      { status: 409 },
    );
  }

  const transfer = await spotifyApiFetch("/me/player", {
    method: "PUT",
    body: JSON.stringify({
      device_ids: [picked.id],
      play: false,
    }),
  });
  if (transfer.status >= 400) {
    return NextResponse.json(
      {
        ok: false,
        status: "spotify_transfer_failed",
        device: picked,
        detail: transfer.data,
      },
      { status: 502 },
    );
  }

  if (startPlayback) {
    const play = await spotifyApiFetch(
      `/me/player/play?device_id=${encodeURIComponent(picked.id)}`,
      { method: "PUT" },
    );
    if (play.status >= 400) {
      return NextResponse.json(
        {
          ok: false,
          status: "spotify_play_failed",
          device: picked,
          detail: play.data,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    status: "handoff_success",
    device: picked,
    visibleDevices: visibleNames,
  });
}
