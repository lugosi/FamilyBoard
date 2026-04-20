import { NextResponse } from "next/server";
import { getHueBridgeIp, hueBridgeFetch, readHueUsername } from "@/lib/hue";

export async function GET() {
  const bridgeIp = getHueBridgeIp();
  const username = await readHueUsername();
  if (!bridgeIp || !username) {
    return NextResponse.json(
      { error: "Configure HUE_BRIDGE_IP and pair the bridge (or set HUE_USERNAME)." },
      { status: 501 },
    );
  }

  const res = await hueBridgeFetch(bridgeIp, username, "/lights");
  if (!res.ok) {
    return NextResponse.json(
      { error: `Bridge returned ${res.status}` },
      { status: 502 },
    );
  }
  const raw = (await res.json()) as Record<
    string,
    {
      name?: string;
      state?: { on?: boolean; reachable?: boolean; bri?: number };
      type?: string;
    }
  >;

  const lights = Object.entries(raw).map(([id, v]) => ({
    id,
    name: v.name ?? `Light ${id}`,
    on: Boolean(v.state?.on),
    reachable: v.state?.reachable !== false,
    bri: v.state?.bri,
    type: v.type,
  }));

  return NextResponse.json({ lights });
}
