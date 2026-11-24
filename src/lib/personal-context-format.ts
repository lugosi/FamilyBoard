/**
 * Pure helpers for personal/<slug>/ continuity folders (no I/O).
 */

import {
  buildWikiIndex,
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
  slugify,
  type WikiPage,
  type WikiPageMeta,
} from "./wiki-format";

export const PERSONAL_ROOT = "personal";
export const PERSONAL_INDEX_BUDGET = 2_500;

export type PersonalContextDepth = "dm" | "channel";

export function personalFolder(slug: string): string {
  const s = slugify(slug);
  if (!s) throw new Error("personal_slug_required");
  return `${PERSONAL_ROOT}/${s}`;
}

export function personalContextPaths(slug: string): {
  folder: string;
  index: string;
  profile: string;
  strava: string;
  openLoops: string;
} {
  const folder = personalFolder(slug);
  return {
    folder,
    index: `${folder}/index.md`,
    profile: `${folder}/profile.md`,
    strava: `${folder}/strava.md`,
    openLoops: `${folder}/open-loops.md`,
  };
}

/** Prefer people/<name>.md stem when slack: matches; else display name / user fallback. */
export function resolvePersonalSlug(input: {
  slackUserId: string;
  displayName?: string | null;
  pages: readonly Pick<WikiPage, "path" | "title" | "content">[];
}): { slug: string; peoplePath: string | null } {
  const want = normalizeSlackUserId(input.slackUserId);
  if (want) {
    for (const page of input.pages) {
      if (!page.path.toLowerCase().startsWith("people/")) continue;
      const id = extractSlackUserIdFromPage(page.content);
      if (id !== want) continue;
      const stem = page.path.replace(/^people\//i, "").replace(/\.md$/i, "");
      const slug = slugify(stem) || slugify(page.title);
      if (slug) return { slug, peoplePath: page.path };
    }
  }
  const fromName = slugify(input.displayName ?? "");
  if (fromName) return { slug: fromName, peoplePath: null };
  const tail = (want ?? input.slackUserId).replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
  return { slug: `user-${tail || "unknown"}`, peoplePath: null };
}

export function isPersonalContextPath(path: string, slug?: string): boolean {
  const p = path.replace(/^\/+/, "").toLowerCase();
  if (slug) return p.startsWith(`${PERSONAL_ROOT}/${slugify(slug).toLowerCase()}/`);
  return p.startsWith(`${PERSONAL_ROOT}/`);
}

/** Build a compact index of pages under personal/<slug>/. */
export function buildPersonalContextIndex(
  pages: readonly WikiPageMeta[],
  slug: string,
  budget = PERSONAL_INDEX_BUDGET,
): string {
  const folder = personalFolder(slug).toLowerCase() + "/";
  const mine = pages.filter((p) => p.path.toLowerCase().startsWith(folder));
  if (!mine.length) return `(no personal pages yet under personal/${slugify(slug)}/)`;
  return buildWikiIndex(mine, budget);
}

export function personalIndexTemplate(slug: string, displayName: string): string {
  const name = displayName.trim() || slug;
  return `---
title: ${name} · personal index
summary: Personal context folder for ${name} (Slack continuity)
tags: [personal, context]
---

# ${name} · personal

Context files the assistant may load when chatting with ${name} on Slack.

## Contexts

- [profile.md](./profile.md) — how to address them, durable prefs
- [open-loops.md](./open-loops.md) — short notes on in-flight projects
- [strava.md](./strava.md) — training prefs (units, goals) when Strava is linked
`;
}

export function personalProfileTemplate(
  slug: string,
  displayName: string,
  peoplePath: string | null,
): string {
  const name = displayName.trim() || slug;
  const peopleLine = peoplePath
    ? `- Family wiki person page: \`${peoplePath}\``
    : "- (No people/ page linked yet — add `slack: U…` on their people page.)";
  return `---
title: ${name} · profile
summary: Durable personal prefs for ${name}
tags: [personal, profile]
---

# ${name} · profile

## About

- Preferred name: ${name}
${peopleLine}

## Preferences

- (Units, diet, communication style — append as you learn them.)
`;
}

export function personalOpenLoopsTemplate(slug: string, displayName: string): string {
  const name = displayName.trim() || slug;
  return `---
title: ${name} · open loops
summary: Short rolling notes on what ${name} was working on
tags: [personal, open-loops]
---

# ${name} · open loops

## Active

- (Keep to a few bullets. Clear when done.)
`;
}

export function personalStravaTemplate(slug: string, displayName: string): string {
  const name = displayName.trim() || slug;
  return `---
title: ${name} · Strava
summary: Training prefs for ${name} (units, goals, last notes)
tags: [personal, strava]
---

# ${name} · Strava

## Preferences

- Distance units: km (change if they prefer miles)
- Goals: (race, base building, …)

## Notes

- (Last recap highlights the assistant should remember.)
`;
}
