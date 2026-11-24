/**
 * Pure helpers for .context/<SlackUserId>/ continuity folders (templates + paths).
 * Fact parse/TTL/index live in personal-context-facts.ts (zero-import, Node-testable).
 */

import {
  CONTEXT_ROOT,
  normalizeSlackUserId,
  slugify,
} from "./wiki-format";
import {
  buildPersonalContextFactIndex,
  CONTEXT_FACT_BASE_TTL_DAYS,
  CONTEXT_FACT_MAX_WEIGHT,
  type ContextPageForIndex,
} from "./personal-context-facts";

export { CONTEXT_ROOT };
export {
  bumpFactOnRecurrence,
  CONTEXT_FACT_BASE_TTL_DAYS,
  CONTEXT_FACT_MAX_WEIGHT,
  CONTEXT_FACT_MIN_WEIGHT,
  clampFactWeight,
  daysBetweenDateKeys,
  extractContextFacts,
  factTtlDays,
  formatContextFact,
  isFactStale,
  newContextFact,
  parseContextFactLine,
  type ContextFact,
  type ContextPageForIndex,
} from "./personal-context-facts";

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

/** Build a compact index of pages + fact freshness under `.context/<SlackUserId>/`. */
export function buildPersonalContextIndex(
  pages: readonly ContextPageForIndex[],
  slackUserId: string,
  opts?: { budget?: number; today?: string },
): string {
  return buildPersonalContextFactIndex(pages, personalFolder(slackUserId), {
    budget: opts?.budget ?? PERSONAL_INDEX_BUDGET,
    today: opts?.today,
  });
}

function frontmatterDates(today: string): string {
  return `created: ${today}\nupdated: ${today}`;
}

export function personalIndexTemplate(
  slackUserId: string,
  displayName: string,
  today: string,
): string {
  const name = displayName.trim() || slackUserId;
  const folder = personalFolder(slackUserId);
  return `---
title: ${name} · context index
summary: Hidden Slack continuity folder for ${name}
tags: [context]
${frontmatterDates(today)}
---

# ${name} · context

Private-ish continuity files for Slack (path \`${folder}/\`). Not listed in the board Wiki browser.

## Contexts

- [profile.md](./profile.md) — how to address them, durable prefs + Facts
- [open-loops.md](./open-loops.md) — short notes on in-flight projects
- [strava.md](./strava.md) — training prefs when Strava is linked

## Fact format

Use under \`## Facts\` on context pages:

\`- Prefer miles · created: ${today} · updated: ${today} · weight: 1\`

Weight 1–${CONTEXT_FACT_MAX_WEIGHT} (bump on recurrence). Fresh for ${CONTEXT_FACT_BASE_TTL_DAYS} × weight days after \`updated\`.
`;
}

export function personalProfileTemplate(
  slackUserId: string,
  displayName: string,
  peoplePath: string | null,
  today: string,
): string {
  const name = displayName.trim() || slackUserId;
  const peopleLine = peoplePath
    ? `- Family wiki person page: \`${peoplePath}\``
    : "- (No people/ page linked yet — add `slack: U…` on their people page.)";
  return `---
title: ${name} · profile
summary: Durable personal prefs for ${name}
tags: [context, profile]
${frontmatterDates(today)}
---

# ${name} · profile

## About

- Preferred name: ${name}
- Slack: ${normalizeSlackUserId(slackUserId) ?? slackUserId}
${peopleLine}

## Facts

- Preferred name is ${name} · created: ${today} · updated: ${today} · weight: 2

## Preferences

- (Free-form notes OK; durable prefs also belong under Facts with dates + weight.)
`;
}

export function personalOpenLoopsTemplate(
  slackUserId: string,
  displayName: string,
  today: string,
): string {
  const name = displayName.trim() || slackUserId;
  return `---
title: ${name} · open loops
summary: Short rolling notes on what ${name} was working on
tags: [context, open-loops]
${frontmatterDates(today)}
---

# ${name} · open loops

## Active

- (Keep to a few bullets. Clear when done. Short-lived — not long-term Facts.)

## Facts

- (Optional project prefs with dates + weight; drop when the loop closes.)
`;
}

export function personalStravaTemplate(
  slackUserId: string,
  displayName: string,
  today: string,
): string {
  const name = displayName.trim() || slackUserId;
  return `---
title: ${name} · Strava
summary: Training prefs for ${name} (units, goals, last notes)
tags: [context, strava]
${frontmatterDates(today)}
---

# ${name} · Strava

## Facts

- Distance units: km · created: ${today} · updated: ${today} · weight: 1

## Preferences

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
