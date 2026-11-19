/**
 * Safe public-URL fetch for the family agent (gym schedules, ICS, static pages).
 * Pure enough for unit tests — no Gemini. Blocks private hosts (SSRF).
 */

export const FETCH_URL_MAX_BYTES = 1_500_000;
export const FETCH_URL_MAX_CHARS = 40_000;
export const FETCH_URL_TIMEOUT_MS = 15_000;
export const FETCH_URL_MAX_REDIRECTS = 5;

export type FetchUrlResult = {
  ok: true;
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  truncated: boolean;
  bytes: number;
};

export type FetchUrlError = {
  ok: false;
  error: string;
  url?: string;
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.includes(":")) {
    // IPv6 — block loopback / link-local / ULA / unique-local style prefixes.
    if (
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    ) {
      return true;
    }
  }
  if (isIpv4(host) && isPrivateIpv4(host)) return true;
  return false;
}

/** Validate a user/skill URL before fetching. Throws on bad input. */
export function assertPublicHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("url_required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only_http_https");
  }
  if (url.username || url.password) throw new Error("credentials_not_allowed");
  if (isPrivateOrLocalHost(url.hostname)) throw new Error("private_host_blocked");
  return url;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : "";
    });
}

/** Strip HTML to readable plain text for the model. */
export function htmlToReadableText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeBasicEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim().slice(0, 200)
    : undefined;
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  body = body
    .replace(/<\/(p|div|section|article|header|footer|tr|li|h[1-6]|br|hr)[^>]*>/gi, "\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  body = decodeBasicEntities(body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { title, text: body };
}

async function readLimitedBody(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) {
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.byteLength > maxBytes) throw new Error("response_too_large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Fetch a public URL and return plain text (HTML stripped).
 * Follows redirects manually so each hop is SSRF-checked.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  opts: { signal?: AbortSignal; maxChars?: number } = {},
): Promise<FetchUrlResult | FetchUrlError> {
  let current: URL;
  try {
    current = assertPublicHttpUrl(rawUrl);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid_url", url: rawUrl };
  }

  const maxChars = opts.maxChars ?? FETCH_URL_MAX_CHARS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_URL_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= FETCH_URL_MAX_REDIRECTS; hop++) {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain,text/calendar,text/csv,application/json;q=0.9,*/*;q=0.5",
          "User-Agent": "FamilyBoardBot/1.0 (+https://github.com/lugosi/FamilyBoard)",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, error: "redirect_missing_location", url: current.toString() };
        let next: URL;
        try {
          next = assertPublicHttpUrl(new URL(loc, current).toString());
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "redirect_blocked",
            url: current.toString(),
          };
        }
        current = next;
        continue;
      }
      break;
    }
    if (!res) return { ok: false, error: "fetch_failed", url: current.toString() };
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        url: current.toString(),
      };
    }

    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = await readLimitedBody(res, FETCH_URL_MAX_BYTES);
    const raw = buf.toString("utf8");
    let title: string | undefined;
    let text: string;
    if (contentType.includes("html") || /^\s*</.test(raw)) {
      const parsed = htmlToReadableText(raw);
      title = parsed.title;
      text = parsed.text;
    } else {
      text = raw;
    }
    const truncated = text.length > maxChars;
    if (truncated) text = `${text.slice(0, maxChars)}\n\n[TRUNCATED]`;
    return {
      ok: true,
      url: rawUrl.trim(),
      finalUrl: current.toString(),
      status: res.status,
      contentType: contentType || "text/plain",
      title,
      text,
      truncated,
      bytes: buf.byteLength,
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "timeout"
          : e.message
        : "fetch_failed";
    return { ok: false, error: msg, url: current.toString() };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
