import { NextResponse } from "next/server";
import { launchSpotifyReceiverOnCastHost } from "@/lib/cast";

export const runtime = "nodejs";

type Body = { host?: string; port?: number };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const host = body.host?.trim();
  if (!host) return NextResponse.json({ error: "host is required" }, { status: 400 });
  const port = Number.isFinite(Number(body.port)) ? Number(body.port) : 8009;

  try {
    console.info("[api/cast/connect] start", { host, port });
    await Promise.race([
      launchSpotifyReceiverOnCastHost(host, port),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("cast_connect_route_timeout")), 15_000);
      }),
    ]);
    console.info("[api/cast/connect] ok", { host, port });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/cast/connect] error", {
      host,
      port,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cast_connect_failed" },
      { status: 502 },
    );
  }
}
