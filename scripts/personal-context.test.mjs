// node --test scripts/personal-context.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildWikiIndex,
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
  slugify,
} from "../src/lib/wiki-format.ts";

/** Mirror of resolvePersonalSlug (keeps this test free of extensionless TS imports). */
function resolvePersonalSlug(input) {
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

test("personal paths follow personal/<slug>/…", () => {
  assert.equal(`personal/${slugify("Maya Lutz")}`, "personal/maya-lutz");
  assert.equal(`personal/${slugify("maya")}/profile.md`, "personal/maya/profile.md");
});

test("resolvePersonalSlug uses people page slack: frontmatter", () => {
  const hit = resolvePersonalSlug({
    slackUserId: "u012abcdef",
    displayName: "Someone Else",
    pages: [
      {
        path: "people/maya.md",
        title: "Maya",
        content: `---
title: Maya
slack: U012ABCDEF
---

# Maya
`,
      },
    ],
  });
  assert.equal(hit.slug, "maya");
  assert.equal(hit.peoplePath, "people/maya.md");
});

test("resolvePersonalSlug falls back to display name", () => {
  const hit = resolvePersonalSlug({
    slackUserId: "U999ZZZ",
    displayName: "Alex",
    pages: [],
  });
  assert.equal(hit.slug, "alex");
  assert.equal(hit.peoplePath, null);
});

test("personal index lists only that slug's pages", () => {
  const folder = "personal/maya/";
  const pages = [
    {
      path: "personal/maya/profile.md",
      title: "Maya · profile",
      summary: "prefs",
      tags: ["personal"],
      category: "personal",
      size: 10,
    },
    {
      path: "personal/alex/profile.md",
      title: "Alex · profile",
      summary: "other",
      tags: ["personal"],
      category: "personal",
      size: 10,
    },
  ];
  const mine = pages.filter((p) => p.path.toLowerCase().startsWith(folder));
  const index = buildWikiIndex(mine, 2500);
  assert.match(index, /personal\/maya\/profile\.md/);
  assert.doesNotMatch(index, /personal\/alex/);
});

test("slack bot and agent wire personal context", () => {
  const bot = readFileSync(new URL("../src/lib/slack-bot.ts", import.meta.url), "utf8");
  assert.match(bot, /preparePersonalContextForSlack/);
  assert.match(bot, /personalContext/);
  const agent = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /PERSONAL CONTEXT/);
  assert.match(agent, /personalContext/);
});
