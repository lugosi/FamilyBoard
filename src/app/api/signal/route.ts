import { NextResponse } from "next/server";
import {
  fetchSignalAbout,
  getSignalAllowedSenders,
  getSignalConfig,
  listSignalAccounts,
} from "@/lib/signal";
import { getSignalBotState } from "@/lib/signal-bot";

export async function GET() {
  const cfg = getSignalConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "Set SIGNAL_API_URL and SIGNAL_NUMBER", configured: false },
      { status: 501 },
    );
  }
  const base = {
    configured: true,
    number: cfg.number,
    allowedSenders: getSignalAllowedSenders().map((s) => s.name ?? s.id),
    bot: getSignalBotState(),
  };
  try {
    const [about, accounts] = await Promise.all([
      fetchSignalAbout(),
      listSignalAccounts(),
    ]);
    return NextResponse.json({
      ...base,
      reachable: true,
      mode: about.mode ?? null,
      version: about.version ?? null,
      registered: accounts.includes(cfg.number),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "signal_error";
    return NextResponse.json(
      { ...base, reachable: false, registered: false, error: message },
      { status: 502 },
    );
  }
}
