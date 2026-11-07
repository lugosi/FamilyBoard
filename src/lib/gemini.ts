/** Free-tier friendly default (AI Studio free accounts). Override with GEMINI_MODEL. */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
/**
 * Prefer models that still offer Google Search grounding when the key allows them.
 * 2.5 Flash is gated/deprecated for many free keys; 3.x Search needs billing.
 * If none work, searchWebWithGemini falls back to DuckDuckGo (+ ESPN for scores).
 */
const DEFAULT_SEARCH_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];
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

export function getGeminiSearchModels(): string[] {
  const explicit = process.env.GEMINI_SEARCH_MODEL?.trim();
  if (explicit) return [explicit, ...DEFAULT_SEARCH_MODELS.filter((m) => m !== explicit)];
  return DEFAULT_SEARCH_MODELS;
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

export type GeminiGrounding = {
  queries: string[];
  sources: { title: string; uri: string }[];
};

export type GeminiGenerateResult = GeminiContent & {
  grounding?: GeminiGrounding;
};

/** One generateContent call (with retries). Returns the model turn's raw parts. */
export async function generateGeminiContent(input: {
  system?: string;
  contents: GeminiContent[];
  tools?: GeminiFunctionDeclaration[];
  /** NONE forces a text answer while keeping tool history valid. */
  toolMode?: "AUTO" | "NONE";
  /** Enable Grounding with Google Search (server-side; do not combine with functionDeclarations on 2.5). */
  googleSearch?: boolean;
  /** Override GEMINI_MODEL for this call. */
  model?: string;
  signal?: AbortSignal;
}): Promise<GeminiGenerateResult> {
  const key = getGeminiApiKey();
  if (!key) throw new Error("gemini_not_configured");
  if (input.contents.length === 0) throw new Error("empty_messages");

  const model = input.model?.trim() || getGeminiModel();
  const url = `${getGeminiApiBase()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = { contents: input.contents };
  if (input.system?.trim()) {
    body.systemInstruction = {
      parts: [{ text: input.system.trim() }],
    };
  }
  const tools: Record<string, unknown>[] = [];
  if (input.googleSearch) tools.push({ googleSearch: {} });
  if (input.tools?.length) tools.push({ functionDeclarations: input.tools });
  if (tools.length) {
    body.tools = tools;
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
        candidates?: {
          content?: { parts?: GeminiPart[] };
          groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: { web?: { uri?: string; title?: string } }[];
          };
        }[];
      };
      const candidate = json.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      if (parts.length === 0) throw new Error("Gemini returned empty response");
      const meta = candidate?.groundingMetadata;
      const grounding: GeminiGrounding | undefined = meta
        ? {
            queries: meta.webSearchQueries ?? [],
            sources: (meta.groundingChunks ?? [])
              .map((c) => ({
                title: c.web?.title?.trim() || "",
                uri: c.web?.uri?.trim() || "",
              }))
              .filter((s) => s.uri),
          }
        : undefined;
      return { role: "model", parts, ...(grounding ? { grounding } : {}) };
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

function isSearchModelUnavailable(message: string): boolean {
  return /404|NOT_FOUND|not found|not supported|no longer available|deprecated|google_search|Google Search|PERMISSION_DENIED|403|FAILED_PRECONDITION|Search Grounding is not supported/i.test(
    message,
  );
}

/**
 * Look up live public info (scores, news, hours).
 * Tries Gemini Google Search grounding, then a free DuckDuckGo (+ ESPN scoreboard) fallback
 * summarized by the main chat model — so free-tier keys still work without 2.5 Flash.
 */
export async function searchWebWithGemini(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<{ answer: string; queries: string[]; sources: { title: string; uri: string }[]; model: string }> {
  const q = query.trim();
  if (!q) throw new Error("Search query is required");
  const models = getGeminiSearchModels();
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      const result = await generateGeminiContent({
        model,
        googleSearch: true,
        system:
          "You look things up with Google Search for a family home assistant. Be brief and factual. For sports, include the score, teams, and when the game is/was (with timezone if known). If results conflict, say so. Do not invent scores.",
        contents: [{ role: "user", parts: [{ text: q }] }],
        signal: opts?.signal,
      });
      const answer = textFromParts(result.parts);
      if (!answer) throw new Error("Search returned an empty answer");
      return {
        answer,
        queries: result.grounding?.queries ?? [q],
        sources: result.grounding?.sources ?? [],
        model,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (isSearchModelUnavailable(lastError.message)) continue;
      throw lastError;
    }
  }

  // Free fallback: public pages + main Gemini model (no Search grounding required).
  const { duckDuckGoSearch, espnScoreboardBlurb, formatHitsForPrompt } = await import("./web-search");
  const espn = await espnScoreboardBlurb(q, { signal: opts?.signal }).catch(() => null);
  const hits = await duckDuckGoSearch(q, { signal: opts?.signal, limit: 5 }).catch(() => []);
  if (!espn && hits.length === 0) {
    throw (
      lastError ??
      new Error(
        "Web search isn't available right now (Gemini Search needs a billed key or a still-enabled 2.5 Flash model).",
      )
    );
  }
  const sources = [
    ...(espn ? [{ title: "ESPN scoreboard", uri: espn.uri }] : []),
    ...hits.map((h) => ({ title: h.title, uri: h.uri })),
  ];
  const context = [
    espn ? `Official scoreboard data:\n${espn.text}` : "",
    hits.length ? `Web results:\n${formatHitsForPrompt(hits)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const summarized = await generateGeminiContent({
    model: getGeminiModel(),
    system:
      "You are a family home assistant. Answer ONLY from the provided search/scoreboard excerpts. Be brief. For sports, give the score and status. If the excerpts don't contain the answer, say you couldn't find it — never invent scores.",
    contents: [
      {
        role: "user",
        parts: [{ text: `Question: ${q}\n\n${context}` }],
      },
    ],
    signal: opts?.signal,
  });
  const answer = textFromParts(summarized.parts);
  if (!answer) throw new Error("Search fallback returned an empty answer");
  return { answer, queries: [q], sources, model: `fallback+${getGeminiModel()}` };
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
