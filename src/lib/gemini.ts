const DEFAULT_MODEL = "gemini-2.0-flash";

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export type GeminiMessage = {
  role: "user" | "model" | "system";
  content: string;
};

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export async function generateGeminiText(input: {
  system?: string;
  messages: GeminiMessage[];
}): Promise<string> {
  const key = getGeminiApiKey();
  if (!key) throw new Error("gemini_not_configured");

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const contents: GeminiContent[] = [];
  for (const m of input.messages) {
    if (m.role === "system") continue;
    contents.push({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  if (contents.length === 0) {
    throw new Error("empty_messages");
  }

  const body: Record<string, unknown> = { contents };
  if (input.system?.trim()) {
    body.systemInstruction = {
      parts: [{ text: input.system.trim() }],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}
