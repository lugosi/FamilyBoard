import { NextResponse } from "next/server";
import { getHueBridgeIp, hueBridgeFetch, readHueUsername } from "@/lib/hue";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const bridgeIp = getHueBridgeIp();
  const username = await readHueUsername();
  if (!bridgeIp || !username) {
    return NextResponse.json({ error: "Hue not configured" }, { status: 501 });
  }

  let body: { on?: boolean };
  try {
    body = (await request.json()) as { on?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "Provide { \"on\": true|false }" }, { status: 400 });
  }

  const res = await hueBridgeFetch(bridgeIp, username, `/groups/${id}/action`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on: body.on }),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Bridge returned ${res.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
