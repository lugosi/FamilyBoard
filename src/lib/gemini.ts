const DEFAULT_MODEL = "gemini-3.6-flash";

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
  signal?: AbortSignal;
}): Promise<string> {
  const key = getGeminiApiKey();
  if (!key) throw new Error("gemini_not_configured");

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
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
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("Gemini returned empty response");
      return text;
    }

    const text = await res.text().catch(() => "");
    const status = res.status;
    const isRetryable = status === 429 || status === 503 || status === 504;
    const shouldRetry = isRetryable && attempt < maxAttempts - 1;

    if (!shouldRetry) {
      lastError = new Error(`Gemini ${status}: ${text.slice(0, 240)}`);
      break;
    }

    const backoffMs =
      parseRetryDelayMs(text) ??
      Math.min(12_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
    await sleep(backoffMs, input.signal);
  }

  throw lastError ?? new Error("Gemini error");
}
