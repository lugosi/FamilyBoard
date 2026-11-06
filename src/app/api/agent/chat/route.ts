import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { isGeminiConfigured } from "@/lib/gemini";
import { runFamilyAgent } from "@/lib/agent";

type ChatMessage = {
  role?: "user" | "model" | "assistant" | "system";
  content?: string;
};

type ChatBody = {
  messages?: ChatMessage[];
};

const MAX_HISTORY = 20;

export async function POST(request: Request) {
  if (!isGeminiConfigured()) {
    return NextResponse.json({ error: "Set GEMINI_API_KEY" }, { status: 501 });
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const messages = (body.messages ?? [])
    .filter((m) => m.content?.trim() && m.role !== "system")
    .map((m) => ({
      role:
        m.role === "model" || m.role === "assistant"
          ? ("model" as const)
          : ("user" as const),
      content: m.content!.trim(),
    }))
    .slice(-MAX_HISTORY);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "messages must end with a user message" },
      { status: 400 },
    );
  }

  try {
    const result = await runFamilyAgent({
      messages,
      redirectUri: getGoogleRedirectUri(request),
      channel: "board",
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "agent_error";
    const status = message.includes("not_configured") ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
