import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clipSlackText, splitSlackText } from "../src/lib/slack.ts";

test("splitSlackText keeps short messages whole", () => {
  assert.deepEqual(splitSlackText("hello"), ["hello"]);
});

test("splitSlackText chunks on paragraph boundaries under the cap", () => {
  const parts = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}. ${"x".repeat(200)}`);
  const text = parts.join("\n\n");
  const chunks = splitSlackText(text, 800);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 800);
  assert.match(chunks[0] ?? "", /^Paragraph 1\./);
  assert.match(chunks.join(""), /Paragraph 20\./);
});

test("clipSlackText adds an ellipsis when over max", () => {
  const clipped = clipSlackText("a".repeat(50), 20);
  assert.equal(clipped.length, 20);
  assert.ok(clipped.endsWith("…"));
});

test("approval lead budget keeps most detail in the first chunk", () => {
  // Mirrors Slack Approve posts: ~2400 char main section before overflow thread.
  const leadBudget = 2400;
  const prose = ["Here's what I staged:", ...Array.from({ length: 40 }, (_, i) => `• Detail line ${i + 1} with some explanation.`)].join(
    "\n",
  );
  const chunks = splitSlackText(prose, leadBudget);
  const first = chunks[0] ?? "";
  assert.ok(first.length <= leadBudget);
  assert.ok(first.includes("Here's what I staged"));
  assert.ok(first.includes("Detail line 1"));
  // Only spill when we actually exceed the budget — not at a tiny 500-char cutoff.
  assert.ok(prose.length > 500);
  if (prose.length <= leadBudget) {
    assert.equal(chunks.length, 1);
  } else {
    assert.ok(chunks.length >= 2);
    assert.doesNotMatch(first, /Full summary is in the thread/);
  }
});

test("slack-bot posts approval lead from body, not a stub", () => {
  const bot = readFileSync(new URL("../src/lib/slack-bot.ts", import.meta.url), "utf8");
  assert.match(bot, /SLACK_APPROVAL_LEAD_CHARS/);
  assert.match(bot, /splitSlackText\(prose, SLACK_APPROVAL_LEAD_CHARS\)/);
  assert.doesNotMatch(bot, /Full summary is in the thread/);
  assert.doesNotMatch(bot, /shortBody/);
});
