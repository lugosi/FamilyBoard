import { NextResponse } from "next/server";
import { launchSpotifyReceiverOnCastHost } from "@/lib/cast";

export const runtime = "nodejs";

type Body = { host?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const host = body.host?.trim();
  if (!host) return NextResponse.json({ error: "host is required" }, { status: 400 });

  try {
    await launchSpotifyReceiverOnCastHost(host);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cast_connect_failed" },
      { status: 502 },
    );
  }
}
