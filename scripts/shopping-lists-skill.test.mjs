// node --test scripts/shopping-lists-skill.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("agent wires shopping skill, update_todo, and Amazon offer", () => {
  const src = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(src, /SHOPPING_LISTS_SKILL/);
  assert.match(src, /name: "update_todo"/);
  assert.match(src, /shopping:\s*\{/);
  assert.match(src, /suggestedAmazonSearchUrl/);
  assert.match(src, /ensureShoppingListsWikiSkill/);
  assert.match(src, /amazonProductSearchUrl/);
});

test("wiki skill seed and docs template exist", () => {
  const seeds = readFileSync(new URL("../src/lib/wiki-skill-seeds.ts", import.meta.url), "utf8");
  assert.match(seeds, /ensureShoppingListsWikiSkill/);
  assert.match(seeds, /SHOPPING_LISTS_SKILL_MARKDOWN/);
  assert.match(seeds, /Santa Monica/);
  const doc = readFileSync(
    new URL("../docs/wiki-skills/shopping-lists.md", import.meta.url),
    "utf8",
  );
  assert.match(doc, /Amazon/);
  assert.match(doc, /Santa Monica/);
  assert.match(doc, /search_web/);
  assert.match(doc, /fetch_url/);
});

test("wiki control and auth status expose shopping skill seed", () => {
  const control = readFileSync(
    new URL("../src/app/api/wiki/control/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(control, /ensure_shopping_lists_skill/);
  const status = readFileSync(
    new URL("../src/app/api/auth/status/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(status, /shoppingListsSkillInWiki/);
});
