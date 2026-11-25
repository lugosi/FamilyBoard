// node --test scripts/markdown-slack.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateKeyFromTableRow,
  formatSlackTable,
  formatSlackTableBullets,
  formatSlackTableCode,
  googleCalendarDayUrl,
  markdownTablesForSlack,
  parseDateKeyFromCell,
  splitTableRow,
} from "../src/lib/markdown-slack.ts";

const FIXED = new Date("2026-11-25T18:00:00Z"); // Wed afternoon UTC → still Nov 25 in LA
const OPTS = { now: FIXED, timeZone: "America/Los_Angeles" };

test("formatSlackTable always uses bullets (never code fences)", () => {
  const many = [
    ["Day", "High", "Low", "Wind", "Notes"],
    ...Array.from({ length: 12 }, (_, i) => [`D${i}`, "70", "50", "5", "x".repeat(20)]),
  ];
  const out = formatSlackTable(many, OPTS);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /^• /m);
});

test("formatSlackTableCode is bullets alias (no monospace grid)", () => {
  const out = formatSlackTableCode(
    [
      ["Day", "High"],
      ["Mon", "72"],
    ],
    OPTS,
  );
  assert.doesNotMatch(out, /```/);
  assert.match(out, /• \*Mon\*: 72/);
});

test("formatSlackTableBullets uses Area · When — Item for 3-col rows", () => {
  const out = formatSlackTableBullets(
    [
      ["Area", "When", "Item"],
      ["Park", "Sat 10am", "Picnic"],
    ],
    OPTS,
  );
  assert.match(out, /• \*Park\* · Sat 10am — Picnic/);
  assert.doesNotMatch(out, /calendar\.google\.com/); // no concrete date
});

test("splitTableRow accepts optional outer pipes", () => {
  assert.deepEqual(splitTableRow("| Day | High |"), ["Day", "High"]);
  assert.deepEqual(splitTableRow("Day | High"), ["Day", "High"]);
});

test("googleCalendarDayUrl uses unpadded month/day", () => {
  assert.equal(
    googleCalendarDayUrl("2026-11-25"),
    "https://calendar.google.com/calendar/r/day/2026/11/25",
  );
  assert.equal(
    googleCalendarDayUrl("2026-03-05"),
    "https://calendar.google.com/calendar/r/day/2026/3/5",
  );
});

test("parseDateKeyFromCell accepts absolute dates only when unambiguous", () => {
  assert.equal(parseDateKeyFromCell("2026-11-25 10:00", OPTS), "2026-11-25");
  assert.equal(parseDateKeyFromCell("Nov 25, 2026", OPTS), "2026-11-25");
  assert.equal(parseDateKeyFromCell("11/25/2026", OPTS), "2026-11-25");
  assert.equal(parseDateKeyFromCell("Today 3pm", OPTS), "2026-11-25");
  assert.equal(parseDateKeyFromCell("Tomorrow morning", OPTS), "2026-11-26");
  // Do not invent year / resolve bare weekday times
  assert.equal(parseDateKeyFromCell("Nov 25", OPTS), null);
  assert.equal(parseDateKeyFromCell("Sat 10am", OPTS), null);
  assert.equal(parseDateKeyFromCell("Tuesday", OPTS), null);
});

test("dateKeyFromTableRow prefers When column and skips Item today-ish text", () => {
  assert.equal(
    dateKeyFromTableRow(
      ["Area", "When", "Item"],
      ["Kitchen", "2026-11-26", "Today's bread"],
      OPTS,
    ),
    "2026-11-26",
  );
  assert.equal(
    dateKeyFromTableRow(["Area", "When", "Item"], ["Park", "Sat 10am", "Picnic"], OPTS),
    null,
  );
});

test("markdownTablesForSlack rewrites GFM tables to bullets with Cal link", () => {
  const input = `Here's the plan:

| Area | When | Item |
| --- | --- | --- |
| School | 2026-11-25 | Pickup |
| Park | Sat 10am | Picnic |

See you.`;
  const out = markdownTablesForSlack(input, OPTS);
  assert.match(out, /Here's the plan:/);
  assert.match(out, /See you\./);
  assert.doesNotMatch(out, /^\| Area \|/m);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /• \*School\* · 2026-11-25 — Pickup <https:\/\/calendar\.google\.com\/calendar\/r\/day\/2026\/11\/25\|Cal>/);
  assert.match(out, /• \*Park\* · Sat 10am — Picnic$/m);
  assert.doesNotMatch(out, /Park.*calendar\.google/);
});

test("markdownTablesForSlack rewrites separator-less pipe tables", () => {
  const input = `| Day | High |
| Mon | 72 |
| Tue | 68 |`;
  const out = markdownTablesForSlack(input, OPTS);
  assert.doesNotMatch(out, /\|/);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack accepts short separator dashes", () => {
  const input = `| Day | High |
| - | - |
| Mon | 72 |`;
  const out = markdownTablesForSlack(input, OPTS);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack tolerates mismatched separator columns", () => {
  const input = `| Day | High | Low |
| --- | --- |
| Mon | 72 | 58 |`;
  const out = markdownTablesForSlack(input, OPTS);
  assert.match(out, /• \*Mon\* · 72 — 58/);
});

test("markdownTablesForSlack rewrites pipe tables inside fences", () => {
  const input = "Before\n```\n| Day | High |\n| --- | --- |\n| Mon | 72 |\n```\nAfter";
  const out = markdownTablesForSlack(input, OPTS);
  assert.match(out, /Before/);
  assert.match(out, /After/);
  assert.doesNotMatch(out, /\| Day \|/);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /• \*Mon\*: 72/);
});

test("markdownTablesForSlack leaves non-table fenced pipes alone", () => {
  const input = "Before\n```\nuse a | b for alternation\n```\nAfter";
  const out = markdownTablesForSlack(input, OPTS);
  assert.match(out, /use a \| b for alternation/);
});

test("markdownTablesForSlack does not treat prose pipes as a table", () => {
  const input = "Meet Mon | Tue\nor Wed | Thu instead.";
  assert.equal(markdownTablesForSlack(input, OPTS), input);
});

test("markdownTablesForSlack is a no-op without pipes", () => {
  assert.equal(markdownTablesForSlack("Just a sentence.", OPTS), "Just a sentence.");
});

test("markdownTablesForSlack is idempotent after rewrite", () => {
  const input = `| A | B |
| --- | --- |
| 1 | 2 |`;
  const once = markdownTablesForSlack(input, OPTS);
  assert.equal(markdownTablesForSlack(once, OPTS), once);
});
