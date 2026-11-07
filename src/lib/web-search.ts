/**
 * Free web lookup fallback when Gemini Google Search grounding isn't available
 * (Gemini 3 free tier has no Search; 2.5 Flash is gated/deprecated for many keys).
 */

export type WebHit = { title: string; uri: string; snippet: string };

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<\/?b>/gi, "");
}

/** DuckDuckGo HTML results (no API key). */
export async function duckDuckGoSearch(
  query: string,
  opts?: { signal?: AbortSignal; limit?: number },
): Promise<WebHit[]> {
  const limit = opts?.limit ?? 5;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FamilyBoard/1.0 (+home-dashboard; DuckDuckGo fallback search)",
      Accept: "text/html",
    },
    signal: opts?.signal ?? AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DuckDuckGo search HTTP ${res.status}`);
  const html = await res.text();
  const hits: WebHit[] = [];
  const blockRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && hits.length < limit) {
    let href = decodeHtml(m[1]);
    // DDG wraps outbound links as /l/?uddg=<encoded>
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep wrapped */
      }
    }
    if (!/^https?:/i.test(href)) continue;
    hits.push({
      title: decodeHtml(m[2].replace(/<[^>]+>/g, "")).trim(),
      uri: href,
      snippet: decodeHtml((m[3] ?? "").replace(/<[^>]+>/g, "")).trim(),
    });
  }
  return hits;
}

type EspnEvent = {
  name?: string;
  shortName?: string;
  status?: { type?: { description?: string; completed?: boolean } };
  competitions?: {
    competitors?: {
      homeAway?: string;
      score?: string;
      team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string };
    }[];
  }[];
};

/** Public ESPN scoreboard (no key) when the query looks like a sports score ask. */
export async function espnScoreboardBlurb(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<{ text: string; uri: string } | null> {
  const q = query.toLowerCase();
  const sports: { test: RegExp; path: string; label: string }[] = [
    {
      test: /\b(nba|warriors?|lakers?|celtics|knicks|bulls|suns|clippers|nuggets|mavs|mavericks|heat|nets|sixers|76ers)\b/,
      path: "basketball/nba",
      label: "NBA",
    },
    {
      test: /\b(nfl|49ers|niners|chiefs|rams|cowboys|packers|eagles|bills|ravens)\b/,
      path: "football/nfl",
      label: "NFL",
    },
    {
      test: /\b(mlb|giants|dodgers|yankees|athletics|\ba'?s\b|padres|cubs|red sox)\b/,
      path: "baseball/mlb",
      label: "MLB",
    },
    {
      test: /\b(nhl|sharks|kings|ducks|oilers|rangers)\b/,
      path: "hockey/nhl",
      label: "NHL",
    },
    {
      test: /\b(ncaaf|college football)\b/,
      path: "football/college-football",
      label: "NCAAF",
    },
  ];
  const hit = sports.find((s) => s.test.test(q));
  if (!hit && !/\b(score|final|won|winning|game)\b/.test(q)) return null;
  if (!hit) return null;

  const uri = `https://site.api.espn.com/apis/site/v2/sports/${hit.path}/scoreboard`;
  const res = await fetch(uri, {
    headers: { Accept: "application/json" },
    signal: opts?.signal ?? AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { events?: EspnEvent[] };
  const events = json.events ?? [];
  if (!events.length) return { text: `No ${hit.label} games on today's ESPN scoreboard.`, uri };

  const lines = events.slice(0, 12).map((ev) => {
    const comps = ev.competitions?.[0]?.competitors ?? [];
    const away = comps.find((c) => c.homeAway === "away");
    const home = comps.find((c) => c.homeAway === "home");
    const aName = away?.team?.shortDisplayName ?? away?.team?.abbreviation ?? "?";
    const hName = home?.team?.shortDisplayName ?? home?.team?.abbreviation ?? "?";
    const aScore = away?.score ?? "";
    const hScore = home?.score ?? "";
    const status = ev.status?.type?.description ?? "";
    return `${aName} ${aScore} @ ${hName} ${hScore} (${status})`;
  });
  return { text: `${hit.label} scoreboard:\n${lines.join("\n")}`, uri };
}

export function formatHitsForPrompt(hits: readonly WebHit[]): string {
  return hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.uri}\n   ${h.snippet}`)
    .join("\n\n");
}
