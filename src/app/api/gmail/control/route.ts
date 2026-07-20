import { NextResponse } from "next/server";
import { readGoogleTokens } from "@/lib/google";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { scanInboxToTodos } from "@/lib/gmail";
import { isGeminiConfigured } from "@/lib/gemini";

type ControlBody = {
  action?: "scan_to_todos";
};

export async function POST(request: Request) {
  const tokens = await readGoogleTokens();
  if (!tokens?.refresh_token) {
    return NextResponse.json(
      { error: "Google account not linked" },
      { status: 401 },
    );
  }
  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Set GEMINI_API_KEY" },
      { status: 501 },
    );
  }

  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "scan_to_todos") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const result = await scanInboxToTodos(getGoogleRedirectUri(request));
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "gmail_error";
    const status =
      message.includes("not linked") || message.includes("invalid_grant")
        ? 401
        : message === "gemini_not_configured"
          ? 501
          : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
