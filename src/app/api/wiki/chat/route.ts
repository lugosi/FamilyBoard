import { NextResponse } from "next/server";
import { generateGeminiText, isGeminiConfigured } from "@/lib/gemini";
import {
  buildWikiContext,
  isWikilmGithubConfigured,
  loadWikiPages,
} from "@/lib/wikilm-github";

type ChatMessage = {
  role?: "user" | "model" | "assistant" | "system";
  content?: string;
};

type ChatBody = {
  messages?: ChatMessage[];
};

export async function POST(request: Request) {
  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Set GEMINI_API_KEY" },
      { status: 501 },
    );
  }
  if (!isWikilmGithubConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set WIKILM_GITHUB_REPO and WIKILM_GITHUB_TOKEN for the private wiki",
      },
      { status: 501 },
    );
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const messages = (body.messages ?? [])
    .filter((m) => m.content?.trim())
    .map((m) => ({
      role:
        m.role === "model" || m.role === "assistant"
          ? ("model" as const)
          : m.role === "system"
            ? ("system" as const)
            : ("user" as const),
      content: m.content!.trim(),
    }));
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  try {
    const pages = await loadWikiPages();
    const context = buildWikiContext(pages);
    const reply = await generateGeminiText({
      system: `You are WikiLLM, the family home assistant for FamilyBoard.
Answer using the private family wiki context below when relevant (recipes, household notes, etc.).
If the wiki does not contain the answer, say so clearly and suggest what page they could save.
Do not invent private family facts that are not in the wiki.
Never claim you sent email or modified todos unless the user is clearly in that flow.

=== FAMILY WIKI ===
${context || "(wiki is empty)"}
=== END WIKI ===`,
      messages: messages.filter((m) => m.role !== "system"),
    });
    return NextResponse.json({ reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_chat_error";
    const status =
      message.includes("not_configured") || message.includes("Set ")
        ? 501
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
