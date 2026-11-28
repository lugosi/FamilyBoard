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
import { findReading, hashImageData, readingsPrompt } from "@/lib/image-extraction-format";
import { listReadings } from "@/lib/image-extractions";
import { boardAccountKey, normalizeBoardMemberId } from "@/lib/strava";

type ChatMessage = {
  role?: "user" | "model" | "assistant" | "system";
  content?: string;
  /** Files converted by POST /api/agent/attachments, echoed back with each turn. */
  attachments?: unknown;
};

type ChatBody = {
  messages?: ChatMessage[];
  /** Board: which family member is chatting (for per-user Strava, etc.). */
  actorMember?: string;
  actorName?: string;
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
  const readings = await listReadings("board");
  const incoming = (body.messages ?? []).filter((m) => m.role !== "system");
  const messages: GeminiMessage[] = incoming
    .map((m, idx) => {
      const role =
        m.role === "model" || m.role === "assistant" ? ("model" as const) : ("user" as const);
      const files = role === "user" ? sanitizeAttachments(m.attachments) : [];
      const text = m.content?.trim() ?? "";
      const note = imagePromptNote(files);
      const filePrompt = attachmentsToPrompt(files);
      const cached = new Set<string>();
      const known = files.flatMap((f) => {
        const hit = f.kind === "image" && f.data ? findReading(readings, "board", hashImageData(f.data), Date.now()) : null;
        if (hit && f.data) cached.add(f.data);
        return hit ? [hit] : [];
      });
      const extras = [filePrompt, note, readingsPrompt(known)].filter(Boolean).join("\n\n");
      const content = extras ? `${text || "(see attached)"}\n\n${extras}` : text;
      const isLast = idx === incoming.length - 1;
      // Once an image has a cached reading, only the newest turn carries the bytes.
      const images = imageAttachments(files)
        .filter(({ data }) => isLast || !cached.has(data))
        .map(({ mimeType, data }) => ({ mimeType, data }));
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

  const memberId = body.actorMember ? normalizeBoardMemberId(body.actorMember) : "";
  const actor =
    memberId.length > 0
      ? {
          accountKey: boardAccountKey(memberId),
          displayName: body.actorName?.trim() || memberId,
        }
      : undefined;

  try {
    const result = await runFamilyAgent({
      messages,
      redirectUri: getGoogleRedirectUri(request),
      channel: "board",
      actor,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "agent_error";
    const status = message.includes("not_configured") ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
