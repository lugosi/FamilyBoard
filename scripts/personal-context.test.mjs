// node --test scripts/personal-context.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CONTEXT_ROOT,
  existingWikiPath,
  isContextWikiPath,
  newWikiPath,
  normalizeSlackUserId,
  parseFrontmatter,
  pathForNewPage,
} from "../src/lib/wiki-format.ts";
import {
  buildPersonalContextFactIndex,
  bumpFactOnRecurrence,
  CONTEXT_FACT_BASE_TTL_DAYS,
  factTtlDays,
  formatContextFact,
  isFactStale,
  newContextFact,
  parseContextFactLine,
} from "../src/lib/personal-context-facts.ts";

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

test("fact lines parse/format and TTL scales with weight", () => {
  const fact = newContextFact("Prefers miles", "2026-01-01", 1);
  assert.equal(fact.created, "2026-01-01");
  assert.equal(fact.updated, "2026-01-01");
  assert.equal(fact.weight, 1);
  assert.equal(factTtlDays(1), CONTEXT_FACT_BASE_TTL_DAYS);
  assert.equal(factTtlDays(3), 90);
  assert.equal(isFactStale(fact, "2026-01-31"), false);
  assert.equal(isFactStale(fact, "2026-02-01"), true);

  const bumped = bumpFactOnRecurrence(fact, "2026-01-20");
  assert.equal(bumped.weight, 2);
  assert.equal(bumped.updated, "2026-01-20");
  assert.equal(bumped.created, "2026-01-01");
  assert.equal(isFactStale(bumped, "2026-03-20"), false);
  assert.equal(isFactStale(bumped, "2026-03-22"), true);

  const line = formatContextFact(bumped);
  assert.equal(
    line,
    "- Prefers miles · created: 2026-01-01 · updated: 2026-01-20 · weight: 2",
  );
  assert.deepEqual(parseContextFactLine(line), bumped);

  const heavy = bumpFactOnRecurrence(
    bumpFactOnRecurrence(bumpFactOnRecurrence(bumped, "2026-02-01"), "2026-02-10"),
    "2026-02-15",
  );
  assert.equal(heavy.weight, 5);
  assert.equal(factTtlDays(5), 150);
  assert.equal(isFactStale(heavy, "2026-07-14"), false);
  assert.equal(isFactStale(heavy, "2026-07-16"), true);
});

test("index lists fresh facts and marks stale ones", () => {
  const pages = [
    {
      path: ".context/U012ABCDEF/profile.md",
      title: "Maya · profile",
      summary: "prefs",
      created: "2026-01-01",
      updated: "2026-03-01",
      body: `## Facts

- Prefers miles · created: 2026-01-01 · updated: 2026-03-01 · weight: 3
- Old diet note · created: 2025-01-01 · updated: 2025-01-01 · weight: 1
`,
    },
    {
      path: ".context/U999ZZZ/profile.md",
      title: "Alex · profile",
      summary: "other",
      body: `- Secret · created: 2026-03-01 · updated: 2026-03-01 · weight: 5\n`,
    },
  ];
  const index = buildPersonalContextFactIndex(pages, ".context/U012ABCDEF", {
    today: "2026-03-15",
    budget: 2500,
  });
  assert.match(index, /\.context\/U012ABCDEF\/profile\.md/);
  assert.match(index, /Fresh facts/);
  assert.match(index, /Prefers miles/);
  assert.match(index, /STALE/);
  assert.match(index, /Old diet note/);
  assert.doesNotMatch(index, /U999ZZZ|Secret/);
});

test("frontmatter keeps created alongside updated", () => {
  const raw = `---
title: Test
created: 2026-01-10
updated: 2026-02-01
---

# Test
`;
  const parsed = parseFrontmatter(raw);
  assert.equal(parsed.meta.created, "2026-01-10");
  assert.equal(parsed.meta.updated, "2026-02-01");
});

test("slack bot and agent wire silent .context facts with TTL", () => {
  const bot = readFileSync(new URL("../src/lib/slack-bot.ts", import.meta.url), "utf8");
  assert.match(bot, /preparePersonalContextForSlack/);
  assert.match(bot, /personalContext/);
  assert.match(bot, /ensurePets:\s*true/);
  const agent = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /PERSONAL CONTEXT/);
  assert.match(agent, /WRITE-BACK REQUIRED/);
  assert.match(agent, /wikiWriteTargetsSilentContext/);
  assert.match(agent, /30×weight/);
  assert.match(agent, /STALE/);
  assert.match(agent, /open-loops\.md/);
  assert.match(agent, /Topic-agnostic/);
  assert.match(agent, /create_wiki_page with category/);
  assert.match(agent, /MUST have called a silent/);
  assert.match(agent, /apply immediately with NO Approve/);
  assert.match(agent, /hikes, trips, work/);
  const facts = readFileSync(
    new URL("../src/lib/personal-context-facts.ts", import.meta.url),
    "utf8",
  );
  assert.match(facts, /CONTEXT_FACT_BASE_TTL_DAYS = 30/);
  assert.match(facts, /bumpFactOnRecurrence/);
  const format = readFileSync(
    new URL("../src/lib/personal-context-format.ts", import.meta.url),
    "utf8",
  );
  assert.match(format, /personalPetsTemplate/);
  assert.match(format, /pets\.md/);
});
