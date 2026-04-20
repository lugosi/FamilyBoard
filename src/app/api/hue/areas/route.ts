import { NextResponse } from "next/server";
import { getHueBridgeIp, hueBridgeFetch, readHueUsername } from "@/lib/hue";

type HueGroup = {
  name?: string;
  type?: string;
  state?: { any_on?: boolean; all_on?: boolean };
  action?: { on?: boolean };
};

export async function GET() {
  const bridgeIp = getHueBridgeIp();
  const username = await readHueUsername();
  if (!bridgeIp || !username) {
    return NextResponse.json(
      { error: "Configure HUE_BRIDGE_IP and pair the bridge (or set HUE_USERNAME)." },
      { status: 501 },
    );
  }

  const res = await hueBridgeFetch(bridgeIp, username, "/groups");
  if (!res.ok) {
    return NextResponse.json(
      { error: `Bridge returned ${res.status}` },
      { status: 502 },
    );
  }
  const raw = (await res.json()) as Record<string, HueGroup>;

  const areas = Object.entries(raw)
    .map(([id, g]) => {
      const t = (g.type ?? "").toLowerCase();
      if (t !== "room" && t !== "zone") return null;
      return {
        id,
        name: g.name ?? `Area ${id}`,
        type: t,
        on: Boolean(g.action?.on ?? g.state?.any_on),
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  return NextResponse.json({ areas });
}
