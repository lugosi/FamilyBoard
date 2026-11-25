/**
 * Slack continuity POC (Layer A.5): hidden `.context/<SlackUserId>/` wiki folders.
 * Writes under that prefix apply immediately (no Approve). Shared family wiki still.
 */

import { getDefaultTimeZone } from "./google";
import {
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
} from "./wiki-format";
import {
  buildPersonalContextIndex,
  personalContextPaths,
  personalIndexTemplate,
  personalOpenLoopsTemplate,
  personalPetsTemplate,
  personalProfileTemplate,
  personalStravaTemplate,
  type PersonalContextDepth,
} from "./personal-context-format";
import {
  ensureWikiSkillIfMissing,
  isWikilmGithubConfigured,
  loadWikiPages,
} from "./wikilm-github";

export type { PersonalContextDepth };
export type PersonalContextBundle = {
  /** Slack user id (U…) — folder name under `.context/`. */
  slackUserId: string;
  peoplePath: string | null;
  folder: string;
  depth: PersonalContextDepth;
  index: string;
  seeded: string[];
};

export {
  buildPersonalContextIndex,
  bumpFactOnRecurrence,
  CONTEXT_FACT_BASE_TTL_DAYS,
  CONTEXT_ROOT,
  extractContextFacts,
  factTtlDays,
  formatContextFact,
  isFactStale,
  isPersonalContextPath,
  newContextFact,
  parseContextFactLine,
  personalContextPaths,
  personalFolder,
  PERSONAL_ROOT,
  wikiWriteTargetsSilentContext,
} from "./personal-context-format";

function todayInFamilyZone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDefaultTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function ensurePage(
  path: string,
  content: string,
  commitMessage: string,
): Promise<{ status: "created" | "exists"; path: string }> {
  const result = await ensureWikiSkillIfMissing({ path, content, commitMessage });
  return { status: result.status, path: result.path };
}

function findPeoplePathForSlack(
  pages: { path: string; content: string }[],
  slackUserId: string,
): string | null {
  const want = normalizeSlackUserId(slackUserId);
  if (!want) return null;
  for (const page of pages) {
    if (!page.path.toLowerCase().startsWith("people/")) continue;
    if (extractSlackUserIdFromPage(page.content) === want) return page.path;
  }
  return null;
}

/**
 * Seed missing starter pages under `.context/<SlackUserId>/`, return index for the prompt.
 * Best-effort: wiki failures return null so Slack chat still works.
 */
export async function preparePersonalContextForSlack(input: {
  slackUserId: string;
  displayName?: string | null;
  depth: PersonalContextDepth;
  ensureStrava?: boolean;
  /** Seed pets.md when CatLink / Petlibro (or similar) is configured. */
  ensurePets?: boolean;
}): Promise<PersonalContextBundle | null> {
  if (!isWikilmGithubConfigured()) return null;
  const slackUserId = normalizeSlackUserId(input.slackUserId);
  if (!slackUserId) return null;

  try {
    const today = todayInFamilyZone();
    const pages = await loadWikiPages({ bypassCache: true });
    const peoplePath = findPeoplePathForSlack(pages, slackUserId);
    const paths = personalContextPaths(slackUserId);
    const displayName = input.displayName?.trim() || slackUserId;
    const seeded: string[] = [];

    const starters: { path: string; content: string; msg: string }[] = [
      {
        path: paths.index,
        content: personalIndexTemplate(slackUserId, displayName, today),
        msg: `context: seed ${paths.folder}/index`,
      },
      {
        path: paths.profile,
        content: personalProfileTemplate(slackUserId, displayName, peoplePath, today),
        msg: `context: seed ${paths.folder}/profile`,
      },
      {
        path: paths.openLoops,
        content: personalOpenLoopsTemplate(slackUserId, displayName, today),
        msg: `context: seed ${paths.folder}/open-loops`,
      },
    ];
    if (input.ensureStrava) {
      starters.push({
        path: paths.strava,
        content: personalStravaTemplate(slackUserId, displayName, today),
        msg: `context: seed ${paths.folder}/strava`,
      });
    }
    // Always seed pets.md (family pets come up often; CatLink/Petlibro only makes it likelier).
    if (input.ensurePets !== false) {
      starters.push({
        path: paths.pets,
        content: personalPetsTemplate(slackUserId, displayName, today),
        msg: `context: seed ${paths.folder}/pets`,
      });
    }

    for (const s of starters) {
      const result = await ensurePage(s.path, s.content, s.msg);
      if (result.status === "created") seeded.push(result.path);
    }

    const fresh = seeded.length ? await loadWikiPages({ bypassCache: true }) : pages;
    const index = buildPersonalContextIndex(fresh, slackUserId, { today });

    return {
      slackUserId,
      peoplePath,
      folder: paths.folder,
      depth: input.depth,
      index,
      seeded,
    };
  } catch (e) {
    console.warn(
      "[personal-context] prepare failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
