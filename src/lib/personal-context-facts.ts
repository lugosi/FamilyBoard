/**
 * Pure fact metadata for `.context/` continuity (no imports — Node-testable).
 *
 * Line format:
 *   - Prefers miles · created: 2026-01-15 · updated: 2026-03-01 · weight: 3
 * TTL = 30 × weight days from `updated`.
 */

export const CONTEXT_FACT_BASE_TTL_DAYS = 30;
export const CONTEXT_FACT_MAX_WEIGHT = 5;
export const CONTEXT_FACT_MIN_WEIGHT = 1;

export type ContextFact = {
  text: string;
  created: string;
  updated: string;
  weight: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FACT_LINE_RE =
  /^\s*-\s+(.+?)\s*·\s*created:\s*(\d{4}-\d{2}-\d{2})\s*·\s*updated:\s*(\d{4}-\d{2}-\d{2})\s*·\s*weight:\s*(\d+)\s*$/i;

export function clampFactWeight(n: number): number {
  if (!Number.isFinite(n)) return CONTEXT_FACT_MIN_WEIGHT;
  return Math.min(
    CONTEXT_FACT_MAX_WEIGHT,
    Math.max(CONTEXT_FACT_MIN_WEIGHT, Math.round(n)),
  );
}

export function factTtlDays(weight: number): number {
  return CONTEXT_FACT_BASE_TTL_DAYS * clampFactWeight(weight);
}

function parseDateKey(s: string): number | null {
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

export function daysBetweenDateKeys(from: string, to: string): number | null {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (a == null || b == null) return null;
  return Math.floor((b - a) / 86_400_000);
}

export function isFactStale(fact: ContextFact, today: string): boolean {
  const age = daysBetweenDateKeys(fact.updated, today);
  if (age == null) return true;
  return age > factTtlDays(fact.weight);
}

export function formatContextFact(fact: ContextFact): string {
  const weight = clampFactWeight(fact.weight);
  const text = fact.text.replace(/\s+/g, " ").trim();
  return `- ${text} · created: ${fact.created} · updated: ${fact.updated} · weight: ${weight}`;
}

export function parseContextFactLine(line: string): ContextFact | null {
  const m = line.match(FACT_LINE_RE);
  if (!m) return null;
  const text = m[1].trim();
  if (!text) return null;
  return {
    text,
    created: m[2],
    updated: m[3],
    weight: clampFactWeight(Number(m[4])),
  };
}

export function extractContextFacts(body: string): ContextFact[] {
  const text = body ?? "";
  const factsHeading = text.match(/(?:^|\n)##\s+Facts\s*\n([\s\S]*?)(?=\n##\s+|$)/i);
  const block = factsHeading ? factsHeading[1] : text;
  const out: ContextFact[] = [];
  for (const line of block.split(/\r?\n/)) {
    const fact = parseContextFactLine(line);
    if (fact) out.push(fact);
  }
  return out;
}

export function newContextFact(text: string, today: string, weight = 1): ContextFact {
  return {
    text: text.replace(/\s+/g, " ").trim(),
    created: today,
    updated: today,
    weight: clampFactWeight(weight),
  };
}

export function bumpFactOnRecurrence(fact: ContextFact, today: string): ContextFact {
  return {
    ...fact,
    updated: today,
    weight: clampFactWeight(fact.weight + 1),
  };
}

function stripFrontmatter(content: string): string {
  const m = content.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? content.slice(m[0].length) : content;
}

function createdFromContent(content: string): string | undefined {
  const m = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^created:[ \t]*(.+)$/i);
    if (kv) return kv[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

export type ContextPageForIndex = {
  path: string;
  title: string;
  summary?: string;
  updated?: string;
  created?: string;
  content?: string;
  body?: string;
};

/**
 * Compact index: pages + fresh facts (by weight) + stale warnings.
 */
export function buildPersonalContextFactIndex(
  pages: readonly ContextPageForIndex[],
  folderPrefix: string,
  opts?: { budget?: number; today?: string },
): string {
  const budget = opts?.budget ?? 2_500;
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  const folder = folderPrefix.endsWith("/") ? folderPrefix : `${folderPrefix}/`;
  const root = folder.slice(0, -1);
  const mine = pages.filter((p) => p.path.startsWith(folder) || p.path === root);
  if (!mine.length) {
    return `(no personal pages yet under ${root}/)`;
  }

  const lines: string[] = [
    `Today: ${today}. Fact TTL = ${CONTEXT_FACT_BASE_TTL_DAYS} × weight days from updated (weight 1–${CONTEXT_FACT_MAX_WEIGHT}). Do not treat stale facts as true — confirm or drop.`,
  ];
  let used = lines[0].length + 1;

  const push = (line: string) => {
    if (used + line.length + 1 > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  const freshFacts: { path: string; fact: ContextFact }[] = [];
  const staleFacts: { path: string; fact: ContextFact }[] = [];

  for (const p of [...mine].sort((a, b) => a.path.localeCompare(b.path))) {
    const created =
      p.created || (typeof p.content === "string" ? createdFromContent(p.content) : undefined);
    const body =
      typeof p.body === "string"
        ? p.body
        : typeof p.content === "string"
          ? stripFrontmatter(p.content)
          : "";
    const metaBits = [
      created ? `created ${created}` : null,
      p.updated ? `updated ${p.updated}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (
      !push(
        `- ${p.path} — ${p.title}${p.summary ? `: ${p.summary}` : ""}${
          metaBits ? ` (${metaBits})` : ""
        }`,
      )
    ) {
      push(`- …truncated; use read_wiki_page for the rest.`);
      return lines.join("\n");
    }

    for (const fact of extractContextFacts(body)) {
      const row = { path: p.path, fact };
      if (isFactStale(fact, today)) staleFacts.push(row);
      else freshFacts.push(row);
    }
  }

  freshFacts.sort(
    (a, b) => b.fact.weight - a.fact.weight || a.fact.text.localeCompare(b.fact.text),
  );
  if (freshFacts.length) {
    if (!push("Fresh facts (trust these):")) return lines.join("\n");
    for (const { path, fact } of freshFacts) {
      const ttl = factTtlDays(fact.weight);
      if (
        !push(
          `  • w${fact.weight} (${fact.updated}, ttl ${ttl}d) ${fact.text} [${path}]`,
        )
      ) {
        push(`  • …and more; read the context pages.`);
        break;
      }
    }
  }

  if (staleFacts.length) {
    if (!push(`Stale facts (${staleFacts.length} — confirm before using, or refresh/drop):`)) {
      return lines.join("\n");
    }
    for (const { path, fact } of staleFacts.slice(0, 8)) {
      if (
        !push(
          `  • STALE w${fact.weight} (updated ${fact.updated}) ${fact.text} [${path}]`,
        )
      ) {
        break;
      }
    }
  }

  return lines.join("\n");
}
