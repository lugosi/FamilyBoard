/**
 * Slack continuity POC (Layer A.5): hidden `.context/<SlackUserId>/` wiki folders.
 * Writes under that prefix apply immediately (no Approve). Shared family wiki still.
 */

import {
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
} from "./wiki-format";
import {
  buildPersonalContextIndex,
  personalContextPaths,
  personalIndexTemplate,
  personalOpenLoopsTemplate,
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
  CONTEXT_ROOT,
  isPersonalContextPath,
  personalContextPaths,
  personalFolder,
  PERSONAL_ROOT,
  wikiWriteTargetsSilentContext,
} from "./personal-context-format";

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
}): Promise<PersonalContextBundle | null> {
  if (!isWikilmGithubConfigured()) return null;
  const slackUserId = normalizeSlackUserId(input.slackUserId);
  if (!slackUserId) return null;

  try {
    const pages = await loadWikiPages({ bypassCache: true });
    const peoplePath = findPeoplePathForSlack(pages, slackUserId);
    const paths = personalContextPaths(slackUserId);
    const displayName = input.displayName?.trim() || slackUserId;
    const seeded: string[] = [];

    const starters: { path: string; content: string; msg: string }[] = [
      {
        path: paths.index,
        content: personalIndexTemplate(slackUserId, displayName),
        msg: `context: seed ${paths.folder}/index`,
      },
      {
        path: paths.profile,
        content: personalProfileTemplate(slackUserId, displayName, peoplePath),
        msg: `context: seed ${paths.folder}/profile`,
      },
      {
        path: paths.openLoops,
        content: personalOpenLoopsTemplate(slackUserId, displayName),
        msg: `context: seed ${paths.folder}/open-loops`,
      },
    ];
    if (input.ensureStrava) {
      starters.push({
        path: paths.strava,
        content: personalStravaTemplate(slackUserId, displayName),
        msg: `context: seed ${paths.folder}/strava`,
      });
    }

    for (const s of starters) {
      const result = await ensurePage(s.path, s.content, s.msg);
      if (result.status === "created") seeded.push(result.path);
    }

    const fresh = seeded.length ? await loadWikiPages({ bypassCache: true }) : pages;
    const index = buildPersonalContextIndex(fresh, slackUserId);

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
