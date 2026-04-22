import { NextResponse } from "next/server";
import { discoverCastDevices } from "@/lib/cast";

export const runtime = "nodejs";

export async function GET() {
  try {
    const devices = await discoverCastDevices();
    console.info("[api/cast/devices] ok", { count: devices.length });
    return NextResponse.json({ devices });
  } catch (e) {
    console.error("[api/cast/devices] error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cast_discovery_failed", devices: [] },
      { status: 500 },
    );
  }
}
