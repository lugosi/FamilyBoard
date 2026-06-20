import { NextResponse } from "next/server";
import { catlinkApiFetch, getCatlinkConfig } from "@/lib/catlink";

export async function GET() {
  if (!getCatlinkConfig()) {
    return NextResponse.json(
      { error: "Set CATLINK_API_BASE_URL and CATLINK_API_TOKEN" },
      { status: 501 },
    );
  }
  try {
    const out = await catlinkApiFetch<Record<string, unknown>>("/stats");
    if (!out.ok) {
      return NextResponse.json(
        {
          error: "Catlink API request failed",
          detail: out.data ?? out.text ?? null,
        },
        { status: out.status >= 400 && out.status < 600 ? out.status : 502 },
      );
    }
    return NextResponse.json(out.data ?? {});
  } catch (e) {
    const message = e instanceof Error ? e.message : "catlink_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
