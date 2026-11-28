// node --test scripts/wiki-slack-people.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayNameForSlackTarget,
  extractSlackUserIdFromPage,
  normalizeSlackUserId,
  parseFrontmatter,
  slackTargetNameNeedsLookup,
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

test("picker uses a Slack display name when the label is only a member id", () => {
  assert.equal(slackTargetNameNeedsLookup("Slack U0123456…", "U0123456789"), true);
  assert.equal(slackTargetNameNeedsLookup("Maya", "U0123456789"), false);
  assert.equal(
    displayNameForSlackTarget("Slack U0123456…", "U0123456789", "Maya Chen"),
    "Maya Chen",
  );
  assert.equal(displayNameForSlackTarget("Maya", "U0123456789", "Maya Chen"), "Maya");
  assert.equal(displayNameForSlackTarget("U0123456789", "U0123456789", undefined), "U0123456789");
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
