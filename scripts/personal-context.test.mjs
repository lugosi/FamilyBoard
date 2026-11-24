// node --test scripts/personal-context.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildWikiIndex,
  CONTEXT_ROOT,
  existingWikiPath,
  isContextWikiPath,
  newWikiPath,
  normalizeSlackUserId,
  pathForNewPage,
} from "../src/lib/wiki-format.ts";

const CONTEXT_HELPERS = readFileSync(
  new URL("../src/lib/personal-context-format.ts", import.meta.url),
  "utf8",
);

test("context paths use .context/<SlackUserId>/…", () => {
  assert.equal(CONTEXT_ROOT, ".context");
  assert.equal(newWikiPath(".context/U012ABCDEF/profile"), ".context/U012ABCDEF/profile.md");
  assert.equal(newWikiPath("context/U012ABCDEF/open-loops"), ".context/U012ABCDEF/open-loops.md");
  assert.equal(existingWikiPath(".context/U012ABCDEF/strava.md"), ".context/U012ABCDEF/strava.md");
  assert.equal(pathForNewPage(".context/U012ABCDEF", "Notes"), ".context/U012ABCDEF/notes.md");
  assert.throws(() => newWikiPath(".git/config"));
});

test("isContextWikiPath detects hidden folder", () => {
  assert.equal(isContextWikiPath(".context/U012/profile.md"), true);
  assert.equal(isContextWikiPath("people/maya.md"), false);
});

test("normalizeSlackUserId preserves U… ids", () => {
  assert.equal(normalizeSlackUserId("u012abcdef"), "U012ABCDEF");
  assert.equal(normalizeSlackUserId("<@U012ABCDEF>"), "U012ABCDEF");
});

test("personal index lists only that Slack user's pages", () => {
  const folder = ".context/U012ABCDEF/";
  const pages = [
    {
      path: ".context/U012ABCDEF/profile.md",
      title: "Maya · profile",
      summary: "prefs",
      tags: ["context"],
      category: ".context",
      size: 10,
    },
    {
      path: ".context/U999ZZZ/profile.md",
      title: "Alex · profile",
      summary: "other",
      tags: ["context"],
      category: ".context",
      size: 10,
    },
  ];
  const mine = pages.filter((p) => p.path.startsWith(folder));
  const index = buildWikiIndex(mine, 2500);
  assert.match(index, /\.context\/U012ABCDEF\/profile\.md/);
  assert.doesNotMatch(index, /U999ZZZ/);
});

test("silent-write helper covers path and category", () => {
  assert.match(CONTEXT_HELPERS, /wikiWriteTargetsSilentContext/);
  assert.match(CONTEXT_HELPERS, /isPersonalContextPath/);
  assert.match(CONTEXT_HELPERS, /CONTEXT_ROOT/);
});

test("slack bot and agent wire silent .context personal context", () => {
  const bot = readFileSync(new URL("../src/lib/slack-bot.ts", import.meta.url), "utf8");
  assert.match(bot, /preparePersonalContextForSlack/);
  assert.match(bot, /personalContext/);
  assert.match(bot, /slackUserId: prepared\.slackUserId/);
  const agent = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /PERSONAL CONTEXT/);
  assert.match(agent, /personalContext/);
  assert.match(agent, /wikiWriteTargetsSilentContext/);
  assert.match(agent, /NO Approve\/Deny/);
});
