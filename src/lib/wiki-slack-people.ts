/**
 * Wiki people pages → Slack DM targets (frontmatter `slack: U…`).
 */

import { readDailyBriefStore } from "./daily-brief-store";
import { isSlackConfigured, listSlackMembers, matchSlackMember } from "./slack";
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

function slackNameError(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("missing_scope")) {
    return "Slack can’t list people (missing users:read). Reinstall the FamilyBoard Slack app, then restart.";
  }
  const detail = raw.replace(/^Slack [^:]+:\s*/, "");
  return `Slack names didn’t load (${detail}).`;
}

/**
 * Combined picker list: wiki people with `slack:` first, then morning-brief
 * subscribers who aren't already covered by a people page.
 * A label that is only a member id is replaced from Slack’s member directory.
 */
export async function loadSlackDeliveryTargets(): Promise<{
  targets: SlackDeliveryTarget[];
  nameError: string | null;
}> {
  const wiki = await listWikiSlackPeople();
  const byId = new Map<string, SlackDeliveryTarget>();
  for (const p of wiki) {
    byId.set(p.userId.toUpperCase(), {
      userId: p.userId,
      name: p.name,
      source: "wiki",
      path: p.path,
    });
  }
  try {
    const store = await readDailyBriefStore();
    for (const id of store.slackUserIds) {
      const key = id.toUpperCase();
      if (byId.has(key)) continue;
      byId.set(key, {
        userId: id,
        name: id,
        source: "registered",
      });
    }
  } catch {
    /* optional */
  }
  const targets = [...byId.values()];
  let nameError: string | null = null;
  if (isSlackConfigured()) {
    const directory = await listSlackMembers().catch((e: unknown) => ({
      members: [],
      error: e instanceof Error ? e.message : String(e),
    }));
    nameError = slackNameError(directory.error);
    for (const target of targets) {
      const member = matchSlackMember(directory.members, target.userId);
      if (!member) continue;
      target.userId = member.id;
      if (slackTargetNameNeedsLookup(target.name, member.id)) {
        target.name = displayNameForSlackTarget(target.name, member.id, member.name);
      }
    }
  }
  targets.sort((a, b) => a.name.localeCompare(b.name));
  return { targets, nameError };
}

export async function listSlackDeliveryTargets(): Promise<SlackDeliveryTarget[]> {
  return (await loadSlackDeliveryTargets()).targets;
}
