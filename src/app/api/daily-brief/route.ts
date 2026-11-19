import { NextResponse } from "next/server";
import { getDailyBriefStatus, runDailyBrief } from "@/lib/daily-brief";
import { patchDailyBriefStore } from "@/lib/daily-brief-store";

export async function GET() {
  const status = await getDailyBriefStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "run";

  if (action === "configure") {
    const patch: {
      enabled?: boolean;
      webAgent?: boolean;
      hour?: number;
      minute?: number;
    } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.webAgent === "boolean") patch.webAgent = body.webAgent;
    if (typeof body.hour === "number") patch.hour = body.hour;
    if (typeof body.minute === "number") patch.minute = body.minute;
    const store = await patchDailyBriefStore(patch);
    return NextResponse.json(store);
  }

  if (action === "run" || action === "send_now") {
    const result = await runDailyBrief({ force: true });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
