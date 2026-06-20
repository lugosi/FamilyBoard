import { NextResponse } from "next/server";
import {
  executeCatlinkAction,
  getCatlinkConfig,
  type CatlinkAction,
} from "@/lib/catlink";

type ControlBody = {
  action?: CatlinkAction;
};

export async function POST(request: Request) {
  if (!(await getCatlinkConfig())) {
    return NextResponse.json(
      { error: "Link Catlink from the board or set CATLINK_PHONE and CATLINK_PASSWORD" },
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
    await executeCatlinkAction(body.action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "catlink_error";
    const status = message === "catlink_not_configured" ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
