import { NextResponse } from "next/server";
import { discoverCastDevices, getConfiguredCastDevices } from "@/lib/cast";

export const runtime = "nodejs";

export async function GET() {
  const configured = getConfiguredCastDevices();
  try {
    const discovered = await discoverCastDevices();
    const byHost = new Map<string, (typeof discovered)[number]>();
    for (const d of configured) byHost.set(d.host, d);
    for (const d of discovered) byHost.set(d.host, d);
    const devices = Array.from(byHost.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    console.info("[api/cast/devices] ok", {
      discovered: discovered.length,
      configured: configured.length,
      total: devices.length,
    });
    return NextResponse.json({ devices });
  } catch (e) {
    if (configured.length > 0) {
      console.warn("[api/cast/devices] discovery_failed_using_configured", {
        configured: configured.length,
        error: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json({ devices: configured, warning: "discovery_failed" });
    }
    console.error("[api/cast/devices] error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cast_discovery_failed", devices: [] },
      { status: 500 },
    );
  }
}
