/** Pure wiki read-tracking and rewrite-guard helpers (no imports — Node-testable). */

export type WikiReadRecord = {
  path: string;
  sha: string;
};

/**
 * Normalize a wiki page path into a canonical lookup key for read-before-rewrite
 * tracking. Strips optional repo `basePath` (e.g. `wiki/`), leading/trailing/duplicate
 * slashes, leading `./`, `.md` extension, and normalizes `context/<SlackUserId>` → `.context/<id>`.
 */
export function normalizeWikiReadKey(rawPath: string, basePath = ""): string {
  let p = rawPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  p = p.replace(/\/{2,}/g, "/");
  p = p.replace(/^(?:\.\/)+/, "");
  const cleanBase = basePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (cleanBase) {
    const lowerP = p.toLowerCase();
    const lowerBase = cleanBase.toLowerCase();
    if (lowerP === lowerBase) {
      p = "";
    } else if (lowerP.startsWith(`${lowerBase}/`)) {
      p = p.slice(cleanBase.length + 1).replace(/^\/+/, "");
    }
  }
  const segs = p.split("/").filter(Boolean);
  if (segs.length >= 2 && segs[0].toLowerCase() === "context") {
    const id = segs[1].trim().toUpperCase().replace(/^<@/, "").replace(/>$/, "");
    if (/^U[A-Z0-9]+$/.test(id)) {
      segs[0] = ".context";
      segs[1] = id;
    }
  }
  return segs.join("/").replace(/\.md$/i, "").toLowerCase();
}

export function recordWikiRead(
  wikiReads: Map<string, WikiReadRecord>,
  pagePath: string,
  sha: string | undefined,
  basePath = "",
): void {
  if (!sha) return;
  const key = normalizeWikiReadKey(pagePath, basePath);
  if (key) wikiReads.set(key, { path: pagePath, sha });
}

export function lookupWikiRead(
  wikiReads: ReadonlyMap<string, WikiReadRecord>,
  pagePath: string,
  basePath = "",
): WikiReadRecord | undefined {
  const key = normalizeWikiReadKey(pagePath, basePath);
  if (!key) return undefined;
  const direct = wikiReads.get(key);
  if (direct) return direct;
  // Backwards-compatible fallback for persisted batches whose keys weren't normalized with basePath.
  for (const [k, record] of wikiReads.entries()) {
    if (
      normalizeWikiReadKey(k, basePath) === key ||
      normalizeWikiReadKey(record.path, basePath) === key
    ) {
      return record;
    }
  }
  return undefined;
}

export function restoreWikiReadsMap(
  entries: Record<string, WikiReadRecord> | undefined,
  basePath = "",
): Map<string, WikiReadRecord> {
  const map = new Map<string, WikiReadRecord>();
  if (!entries) return map;
  for (const [rawKey, record] of Object.entries(entries)) {
    if (!record?.path || !record?.sha) continue;
    const key = normalizeWikiReadKey(record.path || rawKey, basePath);
    if (key) map.set(key, record);
  }
  return map;
}

/**
 * Guard for `rewrite_wiki_page`: ensures the page was read in the current turn
 * (or carried from the proposing turn into an approved batch). Returns either
 * the matching read record or an actionable error message for the model.
 */
export function checkRewriteWikiRead(
  wikiReads: ReadonlyMap<string, WikiReadRecord>,
  rawPath: string,
  basePath = "",
): { ok: true; read: WikiReadRecord } | { ok: false; error: string } {
  const path = rawPath.trim();
  if (!path) {
    return {
      ok: false,
      error:
        "Specify the wiki page path, call read_wiki_page on it first in this turn, then retry rewrite_wiki_page.",
    };
  }
  const read = lookupWikiRead(wikiReads, path, basePath);
  if (!read) {
    return {
      ok: false,
      error: `Call read_wiki_page("${path}") first in this turn to load the latest content and version, then retry rewrite_wiki_page (or use edit_wiki_section to update one section).`,
    };
  }
  return { ok: true, read };
}
