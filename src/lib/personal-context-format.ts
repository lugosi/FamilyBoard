/**
 * Pure helpers for .context/<SlackUserId>/ continuity folders (no I/O).
 */

import {
  buildWikiIndex,
  CONTEXT_ROOT,
  normalizeSlackUserId,
  slugify,
  type WikiPageMeta,
} from "./wiki-format";

export { CONTEXT_ROOT };

export const PERSONAL_INDEX_BUDGET = 2_500;

/** @deprecated use CONTEXT_ROOT — kept as alias for older call sites/tests */
export const PERSONAL_ROOT = CONTEXT_ROOT;

export type PersonalContextDepth = "dm" | "channel";

/** Folder for one Slack user: `.context/U012ABCDEF`. */
export function personalFolder(slackUserId: string): string {
  const id = normalizeSlackUserId(slackUserId);
  if (!id) throw new Error("slack_user_required");
  return `${CONTEXT_ROOT}/${id}`;
}

export function personalContextPaths(slackUserId: string): {
  folder: string;
  index: string;
  profile: string;
  strava: string;
  openLoops: string;
} {
  const folder = personalFolder(slackUserId);
  return {
    folder,
    index: `${folder}/index.md`,
    profile: `${folder}/profile.md`,
    strava: `${folder}/strava.md`,
    openLoops: `${folder}/open-loops.md`,
  };
}

export function isPersonalContextPath(path: string, slackUserId?: string): boolean {
  const p = path.replace(/^\/+/, "");
  if (slackUserId) {
    const id = normalizeSlackUserId(slackUserId);
    if (!id) return false;
    return p === `${CONTEXT_ROOT}/${id}` || p.startsWith(`${CONTEXT_ROOT}/${id}/`);
  }
  return p === CONTEXT_ROOT || p.startsWith(`${CONTEXT_ROOT}/`);
}

/**
 * True when a wiki write tool args targets `.context/…` — those apply immediately
 * (no Approve) so continuity can update silently.
 */
export function wikiWriteTargetsSilentContext(args: Record<string, unknown>): boolean {
  for (const key of ["path", "newPath"] as const) {
    const raw = args[key];
    if (typeof raw === "string" && isPersonalContextPath(raw)) return true;
  }
  if (typeof args.category === "string") {
    const cat = args.category.trim().replace(/^\/+|\/+$/g, "");
    if (
      cat === CONTEXT_ROOT ||
      cat === "context" ||
      cat.startsWith(`${CONTEXT_ROOT}/`) ||
      cat.startsWith("context/")
    ) {
      return true;
    }
  }
  return false;
}

/** Build a compact index of pages under `.context/<SlackUserId>/`. */
export function buildPersonalContextIndex(
  pages: readonly WikiPageMeta[],
  slackUserId: string,
  budget = PERSONAL_INDEX_BUDGET,
): string {
  const folder = personalFolder(slackUserId) + "/";
  const mine = pages.filter((p) => p.path.startsWith(folder) || p.path === folder.slice(0, -1));
  if (!mine.length) {
    return `(no personal pages yet under ${personalFolder(slackUserId)}/)`;
  }
  return buildWikiIndex(mine, budget);
}

export function personalIndexTemplate(slackUserId: string, displayName: string): string {
  const name = displayName.trim() || slackUserId;
  const folder = personalFolder(slackUserId);
  return `---
title: ${name} · context index
summary: Hidden Slack continuity folder for ${name}
tags: [context]
---

# ${name} · context

Private-ish continuity files for Slack (path \`${folder}/\`). Not listed in the board Wiki browser.

## Contexts

- [profile.md](./profile.md) — how to address them, durable prefs
- [open-loops.md](./open-loops.md) — short notes on in-flight projects
- [strava.md](./strava.md) — training prefs when Strava is linked
`;
}

export function personalProfileTemplate(
  slackUserId: string,
  displayName: string,
  peoplePath: string | null,
): string {
  const name = displayName.trim() || slackUserId;
  const peopleLine = peoplePath
    ? `- Family wiki person page: \`${peoplePath}\``
    : "- (No people/ page linked yet — add `slack: U…` on their people page.)";
  return `---
title: ${name} · profile
summary: Durable personal prefs for ${name}
tags: [context, profile]
---

# ${name} · profile

## About

- Preferred name: ${name}
- Slack: ${normalizeSlackUserId(slackUserId) ?? slackUserId}
${peopleLine}

## Preferences

- (Units, diet, communication style — append as you learn them.)
`;
}

export function personalOpenLoopsTemplate(slackUserId: string, displayName: string): string {
  const name = displayName.trim() || slackUserId;
  return `---
title: ${name} · open loops
summary: Short rolling notes on what ${name} was working on
tags: [context, open-loops]
---

# ${name} · open loops

## Active

- (Keep to a few bullets. Clear when done.)
`;
}

export function personalStravaTemplate(slackUserId: string, displayName: string): string {
  const name = displayName.trim() || slackUserId;
  return `---
title: ${name} · Strava
summary: Training prefs for ${name} (units, goals, last notes)
tags: [context, strava]
---

# ${name} · Strava

## Preferences

- Distance units: km (change if they prefer miles)
- Goals: (race, base building, …)

## Notes

- (Last recap highlights the assistant should remember.)
`;
}

/** Optional people-page slug helper (display only). */
export function peopleStemSlug(path: string, title: string): string {
  const stem = path.replace(/^people\//i, "").replace(/\.md$/i, "");
  return slugify(stem) || slugify(title);
}
