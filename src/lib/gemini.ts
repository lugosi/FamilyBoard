/** Free-tier friendly default (AI Studio free accounts). Override with GEMINI_MODEL. */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com";
const MAX_RETRY_DELAY_MS = 12_000;

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function getGeminiApiBase(): string {
  return (process.env.GEMINI_API_BASE_URL?.trim() || DEFAULT_API_BASE).replace(
    /\/+$/,
    "",
  );
}

export type GeminiImage = {
  mimeType: string;
  /** Raw base64, no data: URL prefix. */
  data: string;
};

export type GeminiMessage = {
  role: "user" | "model" | "system";
  content: string;
  /** Photos for this turn only (not stored in long chat memory). */
  images?: GeminiImage[];
};

export type GeminiFunctionCall = {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
};

/** Parts are passed back verbatim so Gemini 3 thought signatures survive tool loops. */
export type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  thought?: boolean;
  thoughtSignature?: string;
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(new Error("Gemini request cancelled"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryDelayMs(text: string): number | null {
  const m1 = text.match(/Please retry in\s+([\d.]+)s/i);
  if (m1?.[1]) {
    const sec = Number(m1[1]);
    if (Number.isFinite(sec)) return Math.max(0, Math.round(sec * 1000));
  }
  const m2 = text.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s/i);
  if (m2?.[1]) {
    const sec = Number(m2[1]);
    if (Number.isFinite(sec)) return Math.max(0, Math.round(sec * 1000));
  }
  return null;
}

export function toGeminiContents(messages: GeminiMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const parts: GeminiPart[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const img of m.images ?? []) {
      if (img.mimeType && img.data) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    if (!parts.length) parts.push({ text: "(see attached)" });
    contents.push({
      role: m.role === "model" ? "model" : "user",
      parts,
    });
  }
  return contents;
}

/** One generateContent call (with retries). Returns the model turn's raw parts. */
export async function generateGeminiContent(input: {
  system?: string;
  contents: GeminiContent[];
  tools?: GeminiFunctionDeclaration[];
  /** NONE forces a text answer while keeping tool history valid. */
  toolMode?: "AUTO" | "NONE";
  signal?: AbortSignal;
}): Promise<GeminiContent> {
  const key = getGeminiApiKey();
  if (!key) throw new Error("gemini_not_configured");
  if (input.contents.length === 0) throw new Error("empty_messages");

  const model = getGeminiModel();
  const url = `${getGeminiApiBase()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = { contents: input.contents };
  if (input.system?.trim()) {
    body.systemInstruction = {
      parts: [{ text: input.system.trim() }],
    };
  }
  if (input.tools?.length) {
    body.tools = [{ functionDeclarations: input.tools }];
    if (input.toolMode) {
      body.toolConfig = { functionCallingConfig: { mode: input.toolMode } };
    }
  }

  const maxAttempts = 4;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] } }[];
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      if (parts.length === 0) throw new Error("Gemini returned empty response");
      return { role: "model", parts };
    }

    const text = await res.text().catch(() => "");
    const status = res.status;
    const isRetryable = status === 429 || status === 503 || status === 504;
    const shouldRetry = isRetryable && attempt < maxAttempts - 1;

    if (!shouldRetry) {
      lastError = new Error(`Gemini ${status}: ${text.slice(0, 240)}`);
      break;
    }

    const backoffMs = Math.min(
      MAX_RETRY_DELAY_MS,
      parseRetryDelayMs(text) ??
        1000 * 2 ** attempt + Math.floor(Math.random() * 400),
    );
    await sleep(backoffMs, input.signal);
  }

  throw lastError ?? new Error("Gemini error");
}

export function textFromParts(parts: GeminiPart[]): string {
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

export async function generateGeminiText(input: {
  system?: string;
  messages: GeminiMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const content = await generateGeminiContent({
    system: input.system,
    contents: toGeminiContents(input.messages),
    signal: input.signal,
  });
  const text = textFromParts(content.parts);
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}
