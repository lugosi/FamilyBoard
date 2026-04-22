import { NextResponse } from "next/server";
import { discoverCastDevices } from "@/lib/cast";

export const runtime = "nodejs";

export async function GET() {
  try {
    const devices = await discoverCastDevices();
    return NextResponse.json({ devices });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cast_discovery_failed", devices: [] },
      { status: 500 },
    );
  }
}
