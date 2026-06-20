import { NextResponse } from "next/server";
import { fetchCatlinkSnapshot, getCatlinkConfig } from "@/lib/catlink";

export async function GET() {
  if (!getCatlinkConfig()) {
    return NextResponse.json(
      { error: "Set CATLINK_PHONE and CATLINK_PASSWORD" },
      { status: 501 },
    );
  }
  try {
    const snapshot = await fetchCatlinkSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "catlink_error";
    const status = message === "catlink_not_configured" ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
