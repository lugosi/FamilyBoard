// node --test scripts/markdown-slack.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSlackTable,
  formatSlackTableBullets,
  formatSlackTableCode,
  markdownTablesForSlack,
  splitTableRow,
} from "../src/lib/markdown-slack.ts";

test("formatSlackTable uses bullets for small grids", () => {
  const out = formatSlackTable([
    ["Day", "High"],
    ["Mon", "72"],
    ["Tue", "68"],
  ]);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /• \*Mon\*: 72/);
  assert.match(out, /• \*Tue\*: 68/);
});

test("formatSlackTableCode pads columns in a code fence", () => {
  const out = formatSlackTableCode([
    ["Day", "High"],
    ["Mon", "72"],
    ["Tue", "68"],
  ]);
  assert.match(out, /^```\n/);
  assert.match(out, /Day\s+High/);
  assert.match(out, /Mon\s+72/);
  assert.match(out, /```$/);
});

test("formatSlackTableBullets labels wide rows with headers", () => {
  const out = formatSlackTableBullets([
    ["Day", "High", "Low"],
    ["Mon", "72", "58"],
  ]);
  assert.match(out, /• \*Day\*: Mon · \*High\*: 72 · \*Low\*: 58/);
});

test("splitTableRow accepts optional outer pipes", () => {
  assert.deepEqual(splitTableRow("| Day | High |"), ["Day", "High"]);
  assert.deepEqual(splitTableRow("Day | High"), ["Day", "High"]);
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
  assert.doesNotMatch(out, /\| Mon \|/);
  assert.match(out, /\*Day\*: Mon/);
  assert.match(out, /\*High\*: 72/);
});

test("markdownTablesForSlack rewrites separator-less pipe tables", () => {
  const input = `| Day | High |
| Mon | 72 |
| Tue | 68 |`;
  const out = markdownTablesForSlack(input);
  assert.doesNotMatch(out, /\|/);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack accepts short separator dashes", () => {
  const input = `| Day | High |
| - | - |
| Mon | 72 |`;
  const out = markdownTablesForSlack(input);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack tolerates mismatched separator columns", () => {
  const input = `| Day | High | Low |
| --- | --- |
| Mon | 72 | 58 |`;
  const out = markdownTablesForSlack(input);
  assert.match(out, /\*Day\*: Mon/);
  assert.match(out, /\*Low\*: 58/);
});

test("markdownTablesForSlack rewrites pipe tables inside fences", () => {
  const input = "Before\n```\n| Day | High |\n| --- | --- |\n| Mon | 72 |\n```\nAfter";
  const out = markdownTablesForSlack(input);
  assert.match(out, /Before/);
  assert.match(out, /After/);
  assert.doesNotMatch(out, /\| Day \|/);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack leaves non-table fenced pipes alone", () => {
  const input = "Before\n```\nuse a | b for alternation\n```\nAfter";
  const out = markdownTablesForSlack(input);
  assert.match(out, /use a \| b for alternation/);
});

test("markdownTablesForSlack does not treat prose pipes as a table", () => {
  const input = "Meet Mon | Tue\nor Wed | Thu instead.";
  assert.equal(markdownTablesForSlack(input), input);
});

test("markdownTablesForSlack is a no-op without pipes", () => {
  assert.equal(markdownTablesForSlack("Just a sentence."), "Just a sentence.");
});

test("markdownTablesForSlack is idempotent after rewrite", () => {
  const input = `| A | B |
| --- | --- |
| 1 | 2 |`;
  const once = markdownTablesForSlack(input);
  assert.equal(markdownTablesForSlack(once), once);
});
