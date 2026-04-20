import { NextResponse } from "next/server";
import { getHueBridgeIp, writeHueUsername } from "@/lib/hue";

export async function POST() {
  const bridgeIp = getHueBridgeIp();
  if (!bridgeIp) {
    return NextResponse.json(
      { error: "Set HUE_BRIDGE_IP on the server" },
      { status: 400 },
    );
  }

  const res = await fetch(`http://${bridgeIp}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devicetype: "family-board#truenas" }),
  });
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) {
    return NextResponse.json({ error: "Unexpected bridge response" }, { status: 502 });
  }

  const first = data[0] as Record<string, unknown>;
  if ("error" in first) {
    const err = first.error as { type?: number; description?: string };
    return NextResponse.json(
      {
        error: err.description ?? "pair_failed",
        type: err.type,
        hint:
          err.type === 101
            ? "Press the link button on the Hue bridge, then try again within ~30 seconds."
            : undefined,
      },
      { status: 400 },
    );
  }

  const success = first.success as { username?: string } | undefined;
  const username = success?.username;
  if (!username) {
    return NextResponse.json({ error: "No username returned" }, { status: 502 });
  }

  await writeHueUsername(username);
  return NextResponse.json({ ok: true, username });
}
