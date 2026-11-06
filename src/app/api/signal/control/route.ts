import { NextResponse } from "next/server";
import {
  getSignalAllowedSenders,
  isSignalConfigured,
  registerSignalNumber,
  sendSignalMessage,
  setSignalProfile,
  verifySignalNumber,
} from "@/lib/signal";
import { pollSignalOnce } from "@/lib/signal-bot";

type ControlBody = {
  action?: "register" | "verify" | "set_profile" | "poll_now" | "send_hello";
  captcha?: string;
  useVoice?: boolean;
  code?: string;
  pin?: string;
  name?: string;
};

export async function POST(request: Request) {
  if (!isSignalConfigured()) {
    return NextResponse.json(
      { error: "Set SIGNAL_API_URL and SIGNAL_NUMBER" },
      { status: 501 },
    );
  }

  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "register":
        await registerSignalNumber({ captcha: body.captcha, useVoice: body.useVoice });
        return NextResponse.json({ ok: true });
      case "verify":
        if (!body.code?.trim()) {
          return NextResponse.json({ error: "code is required" }, { status: 400 });
        }
        await verifySignalNumber({ code: body.code, pin: body.pin });
        await setSignalProfile({
          name: process.env.SIGNAL_BOT_NAME?.trim() || "FamilyBoard",
          about: "Family calendar + todos assistant",
        }).catch(() => undefined);
        return NextResponse.json({ ok: true });
      case "set_profile":
        await setSignalProfile({
          name: body.name?.trim() || process.env.SIGNAL_BOT_NAME?.trim() || "FamilyBoard",
        });
        return NextResponse.json({ ok: true });
      case "poll_now": {
        const received = await pollSignalOnce();
        return NextResponse.json({ ok: true, received });
      }
      case "send_hello": {
        const allowed = getSignalAllowedSenders();
        if (allowed.length === 0) {
          return NextResponse.json(
            { error: "Set SIGNAL_ALLOWED_SENDERS first" },
            { status: 400 },
          );
        }
        for (const s of allowed) {
          await sendSignalMessage(
            s.id,
            `Hi${s.name ? ` ${s.name}` : ""}, this is FamilyBoard. Text me to check or change the family calendar, e.g. "dentist Tuesday 3pm".`,
          );
        }
        return NextResponse.json({ ok: true, sent: allowed.length });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "signal_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
