/**
 * Slack continuity POC (Layer A.5): personal wiki folders under personal/<slug>/.
 * Index is injected into the agent prompt; page bodies load via read_wiki_page.
 * Lives in the shared family wiki (not private GitHub).
 */

import {
  buildPersonalContextIndex,
  personalContextPaths,
  personalIndexTemplate,
  personalOpenLoopsTemplate,
  personalProfileTemplate,
  personalStravaTemplate,
  resolvePersonalSlug,
  type PersonalContextDepth,
} from "./personal-context-format";
import {
  ensureWikiSkillIfMissing,
  isWikilmGithubConfigured,
  loadWikiPages,
} from "./wikilm-github";

export type { PersonalContextDepth };
export type PersonalContextBundle = {
  slug: string;
  peoplePath: string | null;
  folder: string;
  depth: PersonalContextDepth;
  /** Compact index lines for the system prompt (no page bodies). */
  index: string;
  seeded: string[];
};

export {
  buildPersonalContextIndex,
  isPersonalContextPath,
  personalContextPaths,
  personalFolder,
  PERSONAL_ROOT,
  resolvePersonalSlug,
} from "./personal-context-format";

async function ensurePage(
  path: string,
  content: string,
  commitMessage: string,
): Promise<{ status: "created" | "exists"; path: string }> {
  const result = await ensureWikiSkillIfMissing({ path, content, commitMessage });
  return { status: result.status, path: result.path };
}

/**
 * Resolve slug, seed missing starter pages, return index for the system prompt.
 * Best-effort: wiki failures return null so Slack chat still works.
 */
export async function preparePersonalContextForSlack(input: {
  slackUserId: string;
  displayName?: string | null;
  depth: PersonalContextDepth;
  /** When true, also seed strava.md if missing. */
  ensureStrava?: boolean;
}): Promise<PersonalContextBundle | null> {
  if (!isWikilmGithubConfigured()) return null;

  try {
    const pages = await loadWikiPages({ bypassCache: true });
    const { slug, peoplePath } = resolvePersonalSlug({
      slackUserId: input.slackUserId,
      displayName: input.displayName,
      pages,
    });
    const paths = personalContextPaths(slug);
    const displayName = input.displayName?.trim() || slug;
    const seeded: string[] = [];

    const starters: { path: string; content: string; msg: string }[] = [
      {
        path: paths.index,
        content: personalIndexTemplate(slug, displayName),
        msg: `wiki: seed personal/${slug}/index`,
      },
      {
        path: paths.profile,
        content: personalProfileTemplate(slug, displayName, peoplePath),
        msg: `wiki: seed personal/${slug}/profile`,
      },
      {
        path: paths.openLoops,
        content: personalOpenLoopsTemplate(slug, displayName),
        msg: `wiki: seed personal/${slug}/open-loops`,
      },
    ];
    if (input.ensureStrava) {
      starters.push({
        path: paths.strava,
        content: personalStravaTemplate(slug, displayName),
        msg: `wiki: seed personal/${slug}/strava`,
      });
    }

    for (const s of starters) {
      const result = await ensurePage(s.path, s.content, s.msg);
      if (result.status === "created") seeded.push(result.path);
    }

    const fresh = seeded.length ? await loadWikiPages({ bypassCache: true }) : pages;
    const index = buildPersonalContextIndex(fresh, slug);

    return {
      slug,
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
