import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { isGeminiConfigured, type GeminiMessage } from "@/lib/gemini";
import { runFamilyAgent } from "@/lib/agent";
import {
  attachmentsToPrompt,
  imageAttachments,
  imagePromptNote,
  sanitizeAttachments,
} from "@/lib/attachments";

type ChatMessage = {
  role?: "user" | "model" | "assistant" | "system";
  content?: string;
  /** Files converted by POST /api/agent/attachments, echoed back with each turn. */
  attachments?: unknown;
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
  const messages: GeminiMessage[] = (body.messages ?? [])
    .filter((m) => m.role !== "system")
    .map((m) => {
      const role =
        m.role === "model" || m.role === "assistant" ? ("model" as const) : ("user" as const);
      const files = role === "user" ? sanitizeAttachments(m.attachments) : [];
      const text = m.content?.trim() ?? "";
      const note = imagePromptNote(files);
      const filePrompt = attachmentsToPrompt(files);
      const extras = [filePrompt, note].filter(Boolean).join("\n\n");
      const content = extras ? `${text || "(see attached)"}\n\n${extras}` : text;
      const images = imageAttachments(files).map(({ mimeType, data }) => ({ mimeType, data }));
      return {
        role,
        content,
        ...(images.length ? { images } : {}),
      };
    })
    .filter((m) => m.content || m.images?.length)
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
