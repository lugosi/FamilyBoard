import { NextResponse } from "next/server";
import { getAgentMonitorsStatus } from "@/lib/agent-monitors";
import { createAgentMonitor } from "@/lib/agent-monitors-store";
import { isValidCron } from "@/lib/cron";

export async function GET() {
  const status = await getAgentMonitorsStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cron = typeof body.cron === "string" ? body.cron.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!cron || !isValidCron(cron)) {
    return NextResponse.json(
      { error: "cron must be a 5-field expression (min hour dom month dow)" },
      { status: 400 },
    );
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  try {
    const monitor = await createAgentMonitor({
      title: typeof body.title === "string" ? body.title : undefined,
      cron,
      prompt,
      skillPath: typeof body.skillPath === "string" ? body.skillPath : null,
      timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      deliverWeb: typeof body.deliverWeb === "boolean" ? body.deliverWeb : true,
      deliverSlack: typeof body.deliverSlack === "boolean" ? body.deliverSlack : false,
    });
    return NextResponse.json({ monitor });
  } catch (e) {
    const message = e instanceof Error ? e.message : "create_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
