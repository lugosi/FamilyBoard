import { NextResponse } from "next/server";
import { getHueBridgeIp, hueBridgeFetch, readHueUsername } from "@/lib/hue";

const HUE_THEME_ACTIONS: Record<string, Record<string, number | boolean>> = {
  bright: { on: true, bri: 254, ct: 250 },
  relax: { on: true, bri: 170, ct: 367 },
  focus: { on: true, bri: 220, ct: 233 },
  nightlight: { on: true, bri: 25, ct: 447 },
};

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

  let body: { on?: boolean; theme?: string };
  try {
    body = (await request.json()) as { on?: boolean; theme?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const hasOn = typeof body.on === "boolean";
  const theme = (body.theme ?? "").trim().toLowerCase();
  const hasTheme = Boolean(theme);
  if (!hasOn && !hasTheme) {
    return NextResponse.json(
      { error: "Provide { \"on\": true|false } or { \"theme\": \"bright|relax|focus|nightlight\" }" },
      { status: 400 },
    );
  }
  if (hasTheme && !HUE_THEME_ACTIONS[theme]) {
    return NextResponse.json(
      { error: "Unknown theme. Use bright, relax, focus, or nightlight." },
      { status: 400 },
    );
  }
  const payload = hasTheme ? HUE_THEME_ACTIONS[theme] : { on: Boolean(body.on) };

  const res = await hueBridgeFetch(bridgeIp, username, `/groups/${id}/action`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Bridge returned ${res.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
