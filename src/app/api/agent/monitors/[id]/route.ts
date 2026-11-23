import { NextResponse } from "next/server";
import { runAgentMonitor } from "@/lib/agent-monitors";
import {
  deleteAgentMonitor,
  getAgentMonitor,
  patchAgentMonitor,
} from "@/lib/agent-monitors-store";
import { isValidCron } from "@/lib/cron";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = await getAgentMonitor(id);
  if (!monitor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ monitor });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.cron === "string" && !isValidCron(body.cron)) {
    return NextResponse.json(
      { error: "cron must be a 5-field expression (min hour dom month dow)" },
      { status: 400 },
    );
  }

  const slackUserIds = Array.isArray(body.slackUserIds)
    ? body.slackUserIds.filter((x): x is string => typeof x === "string")
    : undefined;

  try {
    const monitor = await patchAgentMonitor(id, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.cron === "string" ? { cron: body.cron } : {}),
      ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
      ...(body.skillPath === null || typeof body.skillPath === "string"
        ? { skillPath: body.skillPath as string | null }
        : {}),
      ...(typeof body.timeZone === "string" ? { timeZone: body.timeZone } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.deliverWeb === "boolean" ? { deliverWeb: body.deliverWeb } : {}),
      ...(typeof body.deliverSlack === "boolean" ? { deliverSlack: body.deliverSlack } : {}),
      ...(slackUserIds !== undefined ? { slackUserIds } : {}),
    });
    if (!monitor) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ monitor });
  } catch (e) {
    const message = e instanceof Error ? e.message : "patch_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const ok = await deleteAgentMonitor(id);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "delete_failed";
    const status = message === "morning_brief_cannot_delete" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "run";
  const monitor = await getAgentMonitor(id);
  if (!monitor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (action === "run" || action === "run_now") {
    try {
      const result = await runAgentMonitor(monitor, { force: true });
      return NextResponse.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "run_failed";
      const status = message.includes("not_configured") ? 501 : 502;
      return NextResponse.json({ error: message }, { status });
    }
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
