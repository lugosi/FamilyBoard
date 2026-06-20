import { NextResponse } from "next/server";
import {
  catlinkApiFetch,
  getCatlinkConfig,
  type CatlinkAction,
} from "@/lib/catlink";

type ControlBody = {
  action?: CatlinkAction;
};

export async function POST(request: Request) {
  if (!getCatlinkConfig()) {
    return NextResponse.json(
      { error: "Set CATLINK_API_BASE_URL and CATLINK_API_TOKEN" },
      { status: 501 },
    );
  }
  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }
  try {
    const out = await catlinkApiFetch<Record<string, unknown>>("/control", {
      method: "POST",
      body: JSON.stringify({ action: body.action }),
    });
    if (!out.ok) {
      return NextResponse.json(
        {
          error: "Catlink control failed",
          detail: out.data ?? out.text ?? null,
        },
        { status: out.status >= 400 && out.status < 600 ? out.status : 502 },
      );
    }
    return NextResponse.json({ ok: true, result: out.data ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "catlink_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
