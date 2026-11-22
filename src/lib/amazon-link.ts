/** Build a public Amazon product search URL for a free-text product name. */
export function amazonProductSearchUrl(query: string): string {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return "https://www.amazon.com/";
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;
}

const HTTP_URL_RE = /^https?:\/\/\S+$/i;

/** True when the string looks like an http(s) product/search link. */
export function looksLikeHttpUrl(value: string | undefined | null): boolean {
  if (!value?.trim()) return false;
  return HTTP_URL_RE.test(value.trim());
}

/**
 * Detect an already-attached product/search URL in a todo title or notes
 * (markdown link or bare https URL).
 */
export function extractUrlFromText(text: string | undefined | null): string | undefined {
  if (!text?.trim()) return undefined;
  const md = text.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (md?.[1]) return md[1];
  const bare = text.match(/(https?:\/\/[^\s<>\]\)]+)/i);
  return bare?.[1];
}
