/**
 * Wiki people pages → Slack DM targets (frontmatter `slack: U…`).
 */

import { readDailyBriefStore } from "./daily-brief-store";
import { getSlackUserName, isSlackConfigured } from "./slack";
import {
  displayNameForSlackTarget,
  extractSlackUserIdFromPage,
  slackTargetNameNeedsLookup,
} from "./wiki-format";
import { isWikilmGithubConfigured, loadWikiPages } from "./wikilm-github";

export type SlackDeliveryTarget = {
  userId: string;
  name: string;
  source: "wiki" | "registered";
  path?: string;
};

/** People pages under `people/` that declare a Slack user id. */
export async function listWikiSlackPeople(): Promise<
  { path: string; name: string; userId: string }[]
> {
  if (!isWikilmGithubConfigured()) return [];
  try {
    const pages = await loadWikiPages();
    const out: { path: string; name: string; userId: string }[] = [];
    for (const page of pages) {
      if (!page.path.toLowerCase().startsWith("people/")) continue;
      const userId = extractSlackUserIdFromPage(page.content);
      if (!userId) continue;
      out.push({
        path: page.path,
        name: page.title || page.path.replace(/^people\//i, "").replace(/\.md$/i, ""),
        userId,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch {
    return [];
  }
}

/**
 * Combined picker list: wiki people with `slack:` first, then morning-brief
 * subscribers who aren't already covered by a people page.
 * Registered rows start as a member id; Slack display names replace those.
 */
export async function listSlackDeliveryTargets(): Promise<SlackDeliveryTarget[]> {
  const wiki = await listWikiSlackPeople();
  const byId = new Map<string, SlackDeliveryTarget>();
  for (const p of wiki) {
    byId.set(p.userId, {
      userId: p.userId,
      name: p.name,
      source: "wiki",
      path: p.path,
    });
  }
  try {
    const store = await readDailyBriefStore();
    for (const id of store.slackUserIds) {
      if (byId.has(id)) continue;
      byId.set(id, {
        userId: id,
        name: `Slack ${id.slice(0, 8)}…`,
        source: "registered",
      });
    }
  } catch {
    /* optional */
  }
  const targets = [...byId.values()];
  if (isSlackConfigured()) {
    await Promise.all(
      targets.map(async (target) => {
        if (!slackTargetNameNeedsLookup(target.name, target.userId)) return;
        const slackName = await getSlackUserName(target.userId).catch(() => undefined);
        target.name = displayNameForSlackTarget(target.name, target.userId, slackName);
      }),
    );
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}
