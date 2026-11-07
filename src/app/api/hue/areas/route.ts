import { NextResponse } from "next/server";
import { listHueAreas } from "@/lib/hue";

export async function GET() {
  try {
    const areas = await listHueAreas();
    return NextResponse.json({ areas });
  } catch (e) {
    const message = e instanceof Error ? e.message : "hue_error";
    const status = /not set up|not configured/i.test(message) ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
