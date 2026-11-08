// Pure wiki page logic (no I/O, no imports) so it can be unit-tested with plain Node.

export type WikiCategory = { id: string; label: string; hint: string };

export const WIKI_CATEGORIES: WikiCategory[] = [
  {
    id: "people",
    label: "People",
    hint: "family members, friends, contacts: birthdays, sizes, allergies, preferences",
  },
  {
    id: "house",
    label: "House",
    hint: "home and appliances: Wi-Fi, utilities, maintenance, warranties, where things are",
  },
  { id: "recipes", label: "Recipes", hint: "family recipes and meal ideas" },
  {
    id: "school",
    label: "School",
    hint: "schools, teachers, class schedules, activities, portals",
  },
  {
    id: "health",
    label: "Health",
    hint: "doctors, dentists, medications, insurance, vaccinations",
  },
  {
    id: "travel",
    label: "Travel",
    hint: "trips, packing lists, documents, loyalty numbers",
  },
  { id: "notes", label: "Notes", hint: "anything that fits nowhere else" },
  {
    id: "todos",
    label: "Todos",
    hint: "open family tasks (checklist the assistant and inbox scan keep current)",
  },
  {
    id: "skills",
    label: "Skills",
    hint: "saved how-tos the assistant reruns, e.g. turning a schedule spreadsheet into calendar events",
  },
];

export const DEFAULT_WIKI_CATEGORY = "notes";
export const SKILLS_FOLDER = "skills";

export function isSkillPath(path: string): boolean {
  return path.toLowerCase().startsWith(`${SKILLS_FOLDER}/`);
}
const MAX_PATH_DEPTH = 3;

export type WikiFrontmatter = {
  title?: string;
  summary?: string;
  tags?: string[];
  updated?: string;
};

export type ParsedPage = {
  meta: WikiFrontmatter;
  /** Frontmatter lines with keys we don't manage, preserved verbatim. */
  extra: string[];
  body: string;
};

export type WikiPageMeta = {
  /** Path relative to the wiki root, e.g. "people/maya.md". */
  path: string;
  title: string;
  summary: string;
  tags: string[];
  updated?: string;
  /** First folder under the wiki root ("" for top-level pages). */
  category: string;
  sha?: string;
  size: number;
};

export type WikiPage = WikiPageMeta & {
  /** Full file text including frontmatter. */
  content: string;
  /** Markdown after the frontmatter. */
  body: string;
  headings: string[];
};

export class WikiPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiPathError";
  }
}

// ---------- frontmatter ----------

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function parseInlineList(value: string): string[] {
  const v = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return v
    .split(",")
    .map((t) => unquote(t))
    .filter(Boolean);
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const t = raw
      .toLowerCase()
      .replace(/[[\]{},#"']/g, "")
      .trim()
      .replace(/\s+/g, "-");
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

export function parseFrontmatter(raw: string): ParsedPage {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, extra: [], body: raw };
  const meta: WikiFrontmatter = {};
  const extra: string[] = [];
  let listKey: "tags" | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/) ?? line.match(/^-\s+(.*)$/);
    if (item && listKey === "tags") {
      meta.tags = [...(meta.tags ?? []), unquote(item[1])];
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (!kv) {
      listKey = null;
      if (line.trim()) extra.push(line);
      continue;
    }
    const key = kv[1].toLowerCase();
    const value = kv[2];
    listKey = null;
    if (key === "title" || key === "summary" || key === "updated") {
      meta[key] = unquote(value);
    } else if (key === "tags") {
      meta.tags = value.trim() ? parseInlineList(value) : [];
      if (!value.trim()) listKey = "tags";
    } else {
      extra.push(line);
    }
  }
  if (meta.tags) meta.tags = normalizeTags(meta.tags);
  return { meta, extra, body: raw.slice(m[0].length) };
}

function yamlScalar(value: string): string {
  const v = value.replace(/\s+/g, " ").trim();
  return /^[\s'"&*!|>%@`\-?[\]{}#,]|[:#]\s|[:#]$|[[\]{}",]/.test(v)
    ? JSON.stringify(v)
    : v;
}

export function renderFrontmatter(meta: WikiFrontmatter, extra: string[] = []): string {
  const lines: string[] = [];
  if (meta.title?.trim()) lines.push(`title: ${yamlScalar(meta.title)}`);
  if (meta.summary?.trim()) lines.push(`summary: ${yamlScalar(meta.summary)}`);
  const tags = normalizeTags(meta.tags);
  if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
  if (meta.updated?.trim()) lines.push(`updated: ${meta.updated.trim()}`);
  lines.push(...extra);
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export function renderPage(parsed: ParsedPage): string {
  const body = normalizeNewlines(parsed.body).replace(/^\n+/, "").trimEnd();
  const fm = renderFrontmatter(parsed.meta, parsed.extra);
  return `${fm}${fm && body ? "\n" : ""}${body}\n`;
}

/** Template for a page created by the assistant or the "New page" form. */
export function composeNewPage(input: {
  title: string;
  summary?: string;
  tags?: string[];
  body?: string;
  updated: string;
}): string {
  const title = input.title.replace(/\s+/g, " ").trim();
  let body = normalizeNewlines(input.body ?? "").trim();
  if (!/^#\s/.test(body)) body = `# ${title}\n\n${body}`.trim();
  return renderPage({
    meta: {
      title,
      summary: input.summary?.trim() || undefined,
      tags: input.tags,
      updated: input.updated,
    },
    extra: [],
    body,
  });
}

/** Template for a saved skill: a reusable procedure the assistant follows next time. */
export function composeSkillPage(input: {
  name: string;
  whenToUse: string;
  inputs?: string;
  steps: readonly string[];
  notes?: string;
  tags?: string[];
  updated: string;
}): string {
  const name = input.name.replace(/\s+/g, " ").trim();
  const steps = input.steps
    .map((step) => normalizeNewlines(step).trim().replace(/^(\d+[.)]|[-*+])\s+/, ""))
    .filter(Boolean);
  if (!name) throw new Error("A skill name is required");
  if (!steps.length) throw new Error("A skill needs at least one step");
  const whenToUse = normalizeNewlines(input.whenToUse).trim();
  const sections = [
    `# ${name}`,
    `## When to use\n\n${whenToUse}`,
    input.inputs?.trim() ? `## Inputs\n\n${normalizeNewlines(input.inputs).trim()}` : "",
    `## Steps\n\n${steps.map((step, i) => `${i + 1}. ${step.replace(/\n/g, "\n   ")}`).join("\n")}`,
    input.notes?.trim() ? `## Notes\n\n${normalizeNewlines(input.notes).trim()}` : "",
  ].filter(Boolean);
  return renderPage({
    meta: {
      title: name,
      summary: whenToUse.split("\n")[0].slice(0, 200),
      tags: ["skill", ...(input.tags ?? [])],
      updated: input.updated,
    },
    extra: [],
    body: sections.join("\n\n"),
  });
}

/** Re-render a page with a new body and/or metadata, stamping `updated`. */
export function withChanges(
  content: string,
  changes: { body?: string; meta?: WikiFrontmatter; updated: string },
): string {
  const parsed = parseFrontmatter(content);
  const meta: WikiFrontmatter = { ...parsed.meta };
  for (const [k, v] of Object.entries(changes.meta ?? {})) {
    if (v !== undefined) (meta as Record<string, unknown>)[k] = v;
  }
  meta.updated = changes.updated;
  return renderPage({
    meta,
    extra: parsed.extra,
    body: changes.body ?? parsed.body,
  });
}

// ---------- headings, titles, summaries ----------

type Heading = { level: number; text: string; line: number };

function listHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line: i });
  });
  return out;
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHeading(s: string): string {
  return stripInlineMarkdown(s)
    .replace(/^#+\s*/, "")
    .replace(/[:.\s]+$/, "")
    .toLowerCase();
}

export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const words = base.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Untitled";
}

export function deriveSummary(body: string, max = 140): string {
  let fence = false;
  for (const raw of normalizeNewlines(body).split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line) continue;
    if (/^(#|\||>|---|\*\*\*|<)/.test(line)) continue;
    const text = stripInlineMarkdown(line.replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""));
    if (!text) continue;
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
  }
  return "";
}

export function categoryOf(path: string): string {
  const segs = path.split("/");
  return segs.length > 1 ? segs[0] : "";
}

export function toWikiPage(path: string, content: string, sha?: string): WikiPage {
  const parsed = parseFrontmatter(content);
  const lines = normalizeNewlines(parsed.body).split("\n");
  const headings = listHeadings(lines);
  const h1 = headings.find((h) => h.level === 1);
  return {
    path,
    title:
      parsed.meta.title?.trim() ||
      (h1 ? stripInlineMarkdown(h1.text) : "") ||
      titleFromPath(path),
    summary: parsed.meta.summary?.trim() || deriveSummary(parsed.body),
    tags: parsed.meta.tags ?? [],
    updated: parsed.meta.updated,
    category: categoryOf(path),
    sha,
    size: content.length,
    content,
    body: parsed.body,
    headings: headings.map((h) => stripInlineMarkdown(h.text)),
  };
}

export function toMeta(page: WikiPage): WikiPageMeta {
  const { path, title, summary, tags, updated, category, sha, size } = page;
  return { path, title, summary, tags, updated, category, sha, size };
}

// ---------- section edits ----------

const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s+/;

export type SectionEditMode = "append" | "replace";

/**
 * Append to or replace one section of a markdown body. A section is a heading
 * plus everything up to the next heading of the same or higher level. Missing
 * sections are created at the end as `## heading`.
 */
export function editSection(
  body: string,
  section: string | undefined,
  text: string,
  mode: SectionEditMode,
): { body: string; created: boolean; heading: string | null } {
  const lines = normalizeNewlines(body).replace(/\n+$/, "").split("\n");
  let addLines = normalizeNewlines(text).trim().split("\n");
  if (!addLines.join("").trim()) throw new Error("Nothing to add");

  const target = section ? normalizeHeading(section) : "";
  if (!target) {
    if (mode === "replace") throw new Error("A section heading is required to replace");
    const last = lines.length ? lines[lines.length - 1] : "";
    const tight = LIST_ITEM_RE.test(last) && LIST_ITEM_RE.test(addLines[0]);
    const next = [...lines];
    if (next.join("").trim() && !tight) next.push("");
    next.push(...addLines);
    return { body: `${next.join("\n").replace(/^\n+/, "")}\n`, created: false, heading: null };
  }

  const headings = listHeadings(lines);
  let idx = headings.findIndex((h) => normalizeHeading(h.text) === target);
  if (idx < 0) {
    const fuzzy = headings
      .map((h, i) => ({ i, n: normalizeHeading(h.text) }))
      .filter(({ n }) => n.includes(target) || target.includes(n));
    if (fuzzy.length === 1) idx = fuzzy[0].i;
  }

  if (idx < 0) {
    const heading = section!.replace(/^#+\s*/, "").trim();
    const next = [...lines];
    if (next.join("").trim()) next.push("");
    next.push(`## ${heading}`, "", ...addLines);
    return { body: `${next.join("\n").replace(/^\n+/, "")}\n`, created: true, heading };
  }

  const h = headings[idx];
  const after = headings.slice(idx + 1).find((x) => x.level <= h.level);
  const end = after ? after.line : lines.length;
  if (addLines[0] && /^#{1,6}\s/.test(addLines[0]) && normalizeHeading(addLines[0]) === normalizeHeading(h.text)) {
    addLines = addLines.slice(1);
    while (addLines.length && !addLines[0].trim()) addLines.shift();
  }

  const before = lines.slice(0, h.line + 1);
  const sectionLines = lines.slice(h.line + 1, end);
  const rest = lines.slice(end);
  let middle: string[];
  if (mode === "replace") {
    middle = ["", ...addLines];
  } else {
    while (sectionLines.length && !sectionLines[sectionLines.length - 1].trim()) sectionLines.pop();
    const lastLine = sectionLines[sectionLines.length - 1] ?? "";
    const tight = LIST_ITEM_RE.test(lastLine) && LIST_ITEM_RE.test(addLines[0] ?? "");
    middle = sectionLines.length
      ? [...sectionLines, ...(tight ? [] : [""]), ...addLines]
      : ["", ...addLines];
  }
  const next = [...before, ...middle, ...(rest.length ? ["", ...rest] : [])];
  return { body: `${next.join("\n")}\n`, created: false, heading: h.text };
}

// ---------- paths ----------

export function slugify(input: string, max = 60): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

function splitRelative(input: string, basePath: string): string[] {
  let p = input.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (basePath && (p === basePath || p.startsWith(`${basePath}/`))) {
    p = p.slice(basePath.length).replace(/^\/+/, "");
  }
  const segs = p.split("/").filter(Boolean);
  if (!segs.length) throw new WikiPathError("Page path is empty");
  if (segs.length > MAX_PATH_DEPTH) {
    throw new WikiPathError(`Page paths can be at most ${MAX_PATH_DEPTH} levels deep`);
  }
  for (const s of segs) {
    if (s === "." || s === ".." || s.startsWith(".") || /[\u0000-\u001f]/.test(s)) {
      throw new WikiPathError(`Invalid page path: ${input}`);
    }
  }
  return segs;
}

/** Path of an existing page, relative to the wiki root (case and spelling preserved). */
export function existingWikiPath(input: string, basePath = ""): string {
  const segs = splitRelative(input, basePath);
  const last = segs.length - 1;
  if (!/\.md$/i.test(segs[last])) segs[last] = `${segs[last]}.md`;
  return segs.join("/");
}

/** Slugified path for a new page or a move target, relative to the wiki root. */
export function newWikiPath(input: string, basePath = ""): string {
  const segs = splitRelative(input, basePath).map((s, i, all) =>
    slugify(i === all.length - 1 ? s.replace(/\.md$/i, "") : s),
  );
  if (segs.some((s) => !s)) throw new WikiPathError(`Invalid page path: ${input}`);
  return `${segs.join("/")}.md`;
}

export function pathForNewPage(category: string | undefined, title: string): string {
  const cat = slugify(category ?? "") || DEFAULT_WIKI_CATEGORY;
  const name = slugify(title);
  if (!name) throw new WikiPathError("A page title is required");
  return `${cat}/${name}.md`;
}

// ---------- search + index ----------

const STOP_WORDS = new Set(
  "a an and are as at be by do does for from has have how i in is it its me my of on or our the to us was we what when where which who why with you your".split(
    " ",
  ),
);

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Crude stem so "allergies" matches "allergy" and "shoes" matches "shoe". */
function stem(t: string): string {
  for (const suffix of ["ies", "es", "s", "y"]) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 4) return t.slice(0, -suffix.length);
  }
  return t;
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      fold(query)
        .replace(/['’]s\b/g, "")
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
        .map(stem),
    ),
  ];
}

function countOccurrences(hay: string, term: string, cap: number): number {
  let n = 0;
  let i = hay.indexOf(term);
  while (i >= 0 && n < cap) {
    n += 1;
    i = hay.indexOf(term, i + term.length);
  }
  return n;
}

function snippetFor(body: string, terms: string[], title: string, width = 180): string {
  const weight = (t: string) => (title.includes(t) ? 0.5 : 1);
  const lines = normalizeNewlines(body)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(---|```|~~~)/.test(l));
  let best: { score: number; index: number; hit: number } | null = null;
  lines.forEach((line, index) => {
    const f = fold(line);
    const matched = terms.filter((t) => f.includes(t));
    if (!matched.length) return;
    const hits = matched.map((t) => f.indexOf(t));
    const heading = line.startsWith("#");
    const score = matched.reduce((sum, t) => sum + weight(t), 0) * 2 - (heading ? 1 : 0);
    if (!best || score > best.score) best = { score, index, hit: Math.min(...hits) };
  });
  if (!best) return "";
  const { index, hit } = best as { index: number; hit: number };
  let line = lines[index];
  if (line.startsWith("#") && lines[index + 1] && !lines[index + 1].startsWith("#")) {
    line = `${line.replace(/^#+\s*/, "")}: ${lines[index + 1]}`;
  }
  const text = stripInlineMarkdown(line.replace(/^#+\s*/, ""));
  if (text.length <= width) return text;
  const start = Math.max(0, Math.min(hit - 40, text.length - width));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + width).trim()}${start + width < text.length ? "…" : ""}`;
}

export type WikiSearchResult = WikiPageMeta & { score: number; snippet: string };

export function searchPages(
  pages: readonly WikiPage[],
  query: string,
  opts: { limit?: number; category?: string } = {},
): WikiSearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const phrase = fold(query).trim();
  const results: WikiSearchResult[] = [];
  for (const page of pages) {
    if (opts.category && page.category !== opts.category) continue;
    const title = fold(page.title);
    const tags = fold(page.tags.join(" "));
    const summary = fold(page.summary);
    const path = fold(page.path);
    const headings = fold(page.headings.join(" "));
    const body = fold(page.body);
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const s =
        (title.includes(t) ? 6 : 0) +
        (tags.includes(t) ? 5 : 0) +
        (summary.includes(t) ? 3 : 0) +
        (path.includes(t) ? 3 : 0) +
        (headings.includes(t) ? 3 : 0) +
        countOccurrences(body, t, 5);
      if (s > 0) matched += 1;
      score += s;
    }
    if (!matched) continue;
    score *= matched / terms.length;
    if (phrase.length > 3 && (title.includes(phrase) || body.includes(phrase))) score += 5;
    results.push({ ...toMeta(page), score: Math.round(score * 10) / 10, snippet: snippetFor(page.body, terms, title) });
  }
  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, opts.limit ?? 8);
}

/** Compact one-line-per-page listing for the assistant's instructions. */
export function buildWikiIndex(pages: readonly WikiPageMeta[], budget = 12_000): string {
  if (!pages.length) return "(the wiki has no pages yet)";
  const sorted = [...pages].sort((a, b) => a.path.localeCompare(b.path));
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const line = `- ${p.path} — ${p.title}${p.summary ? `: ${p.summary}` : ""}${
      p.tags.length ? ` [${p.tags.join(", ")}]` : ""
    }`;
    if (used + line.length + 1 > budget) {
      lines.push(`- …and ${sorted.length - i} more page(s); use search_wiki to find them.`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
