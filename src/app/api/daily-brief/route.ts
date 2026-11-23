import { NextResponse } from "next/server";
import { runAgentMonitor } from "@/lib/agent-monitors";
import {
  ensureMorningBriefMonitor,
  patchAgentMonitor,
} from "@/lib/agent-monitors-store";
import { getDailyBriefStatus, runDailyBrief } from "@/lib/daily-brief";
import { patchDailyBriefStore } from "@/lib/daily-brief-store";
import { isValidCron } from "@/lib/cron";

export async function GET() {
  await ensureMorningBriefMonitor();
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
    // Mirror into the built-in Scheduled check so Tools UI stays in sync.
    const monitor = await ensureMorningBriefMonitor();
    const hour = patch.hour ?? store.hour;
    const minute = patch.minute ?? store.minute;
    const cron = `${minute} ${hour} * * *`;
    await patchAgentMonitor(monitor.id, {
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(typeof patch.webAgent === "boolean" ? { deliverWeb: patch.webAgent } : {}),
      ...(isValidCron(cron) ? { cron } : {}),
      timeZone: store.timeZone,
    });
    return NextResponse.json(store);
  }

  if (action === "run" || action === "send_now") {
    const monitor = await ensureMorningBriefMonitor();
    try {
      const result = await runAgentMonitor(monitor, { force: true });
      return NextResponse.json({
        dateKey: result.slot,
        textSlack: result.reply,
        textBoard: result.reply,
        slack: result.slack,
        webSessionId: result.webSessionId,
        skipped: result.skipped,
        error: result.error,
      });
    } catch {
      const result = await runDailyBrief({ force: true });
      return NextResponse.json(result);
    }
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
