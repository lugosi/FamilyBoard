// node --test scripts/wiki-slack-people.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
  parseFrontmatter,
} from "../src/lib/wiki-format.ts";

test("normalizeSlackUserId accepts U ids", () => {
  assert.equal(normalizeSlackUserId("u012abc"), "U012ABC");
  assert.equal(normalizeSlackUserId("<@U012ABC>"), "U012ABC");
  assert.equal(normalizeSlackUserId("not-an-id"), null);
});

test("parseFrontmatter reads slack: on people pages", () => {
  const parsed = parseFrontmatter(`---
title: Maya
slack: U012ABCDEF
---

# Maya
`);
  assert.equal(parsed.meta.slack, "U012ABCDEF");
});

test("extractSlackUserIdFromPage falls back to body Slack: line", () => {
  const id = extractSlackUserIdFromPage(`---
title: Sam
---

# Sam

Slack ID: U99XYZ
`);
  assert.equal(id, "U99XYZ");
});
