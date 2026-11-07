import { NextResponse } from "next/server";
import {
  controlHueArea,
  getHueBridgeIp,
  HUE_THEMES,
  listHueAreas,
  readHueUsername,
} from "@/lib/hue";

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

  try {
    const areas = await listHueAreas();
    const area = areas.find((a) => a.id === id);
    if (!area) {
      return NextResponse.json({ error: "Unknown Hue area" }, { status: 404 });
    }
    const theme = (body.theme ?? "").trim().toLowerCase();
    if (theme && !(theme in HUE_THEMES)) {
      return NextResponse.json(
        { error: "Unknown theme. Use bright, relax, focus, or nightlight." },
        { status: 400 },
      );
    }
    if (typeof body.on !== "boolean" && !theme) {
      return NextResponse.json(
        { error: 'Provide { "on": true|false } or { "theme": "bright|relax|focus|nightlight" }' },
        { status: 400 },
      );
    }
    const result = await controlHueArea({
      area: area.name,
      on: body.on,
      theme: theme || undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "hue_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
