// node --test scripts/markdown-slack.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSlackTable, markdownTablesForSlack } from "../src/lib/markdown-slack.ts";

test("formatSlackTable pads columns in a code fence", () => {
  const out = formatSlackTable([
    ["Day", "High"],
    ["Mon", "72"],
    ["Tue", "68"],
  ]);
  assert.match(out, /^```\n/);
  assert.match(out, /Day\s+High/);
  assert.match(out, /Mon\s+72/);
  assert.match(out, /```$/);
});

test("markdownTablesForSlack rewrites GFM tables and leaves prose", () => {
  const input = `Here's the forecast:

| Day | High | Low |
| --- | --- | --- |
| Mon | 72 | 58 |
| Tue | 68 | 55 |

Pack a jacket.`;
  const out = markdownTablesForSlack(input);
  assert.match(out, /Here's the forecast:/);
  assert.match(out, /Pack a jacket\./);
  assert.doesNotMatch(out, /^\| Day \|/m);
  assert.match(out, /```/);
  assert.match(out, /Day\s+High\s+Low/);
  assert.match(out, /Mon\s+72\s+58/);
});

test("markdownTablesForSlack skips fenced code that looks like pipes", () => {
  const input = "Before\n```\n| not | a | table |\n```\nAfter";
  const out = markdownTablesForSlack(input);
  assert.match(out, /\| not \| a \| table \|/);
});

test("markdownTablesForSlack is a no-op without pipes", () => {
  assert.equal(markdownTablesForSlack("Just a sentence."), "Just a sentence.");
});
