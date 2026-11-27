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

import { markdownForSlack, markdownToSlackMrkdwn } from "../src/lib/markdown-slack.ts";
import { clipSlackText, splitSlackText } from "../src/lib/slack.ts";

test("markdownToSlackMrkdwn converts bold, strike, headings and rules", () => {
  assert.equal(markdownToSlackMrkdwn("**Hi** there ~~old~~ __x__"), "*Hi* there ~old~ *x*");
  assert.equal(markdownToSlackMrkdwn("***both***"), "*_both_*");
  assert.equal(markdownToSlackMrkdwn("## Plan **today**"), "*Plan today*");
  assert.equal(markdownToSlackMrkdwn("# **Title**"), "*Title*");
  assert.equal(markdownToSlackMrkdwn("a\n---\nb"), "a\n──────────\nb");
});

test("markdownToSlackMrkdwn converts links without touching underscores in URLs", () => {
  assert.equal(
    markdownToSlackMrkdwn("See [the doc](https://x.com/a_b_c?q=1) and **[go](https://y.com/p_q_r)**"),
    "See <https://x.com/a_b_c?q=1|the doc> and *<https://y.com/p_q_r|go>*",
  );
  assert.equal(markdownToSlackMrkdwn("https://x.com/a__b__c"), "https://x.com/a__b__c");
  assert.equal(markdownToSlackMrkdwn("![pic](https://x.com/i.png)"), "<https://x.com/i.png|pic>");
  assert.equal(markdownToSlackMrkdwn("[a|b](https://x.com)"), "<https://x.com|a b>");
});

test("markdownToSlackMrkdwn rewrites bullets and task lists but keeps *bold* lines", () => {
  const out = markdownToSlackMrkdwn("* one\n- two\n  - nested\n- [ ] todo\n- [x] done\n*Key*: v");
  assert.equal(out, "• one\n• two\n  • nested\n☐ todo\n☑ done\n*Key*: v");
});

test("markdownToSlackMrkdwn leaves code alone and drops fence language tags", () => {
  const src = "**a**\n```js\nconst x = **y**; // - z\n# not heading\n```\nUse `**raw**` ok";
  assert.equal(
    markdownToSlackMrkdwn(src),
    "*a*\n```\nconst x = **y**; // - z\n# not heading\n```\nUse `**raw**` ok",
  );
  assert.equal(markdownToSlackMrkdwn("~~~\ncode\n~~~"), "```\ncode\n```");
  assert.equal(markdownToSlackMrkdwn("```\nunclosed"), "```\nunclosed\n```");
});

test("markdownToSlackMrkdwn is idempotent", () => {
  const once = markdownToSlackMrkdwn("## H\n**b** [l](https://a.com/x_y_z)\n* i\n```py\nx\n```");
  assert.equal(markdownToSlackMrkdwn(once), once);
});

test("table cells keep snake_case, links and escaped pipes", () => {
  const out = markdownForSlack(
    "| Name | Link |\n| --- | --- |\n| my_var_name | [Doc](https://x.com/a_b_c) |\n| a \\| b | **bold** |",
    OPTS,
  );
  assert.match(out, /my_var_name/);
  assert.match(out, /<https:\/\/x\.com\/a_b_c\|Doc>/);
  assert.match(out, /\*a \| b\*: bold/);
  assert.doesNotMatch(out, /\*\*/);
});

test("splitSlackText closes and reopens a code fence cut by a split", () => {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
  const chunks = splitSlackText(`intro\n\`\`\`\n${body}\n\`\`\`\nafter`, 400);
  assert.ok(chunks.length > 2);
  for (const c of chunks) {
    assert.ok(c.length <= 400, `chunk length ${c.length}`);
    assert.equal((c.match(/```/g) ?? []).length % 2, 0, c);
  }
});

test("splitSlackText and clipSlackText never cut a Slack link token", () => {
  const link = "<https://example.com/some/long/path|a label with spaces>";
  const text = `${"w ".repeat(180)}${link} tail`;
  for (const c of splitSlackText(text, 372)) {
    const opens = (c.match(/</g) ?? []).length;
    const closes = (c.match(/>/g) ?? []).length;
    assert.equal(opens, closes, c);
  }
  const clipped = clipSlackText(`${"w ".repeat(10)}${link}`, 40);
  assert.doesNotMatch(clipped, /</);
  const fenced = clipSlackText(`\`\`\`\n${"y".repeat(100)}`, 40);
  assert.ok(fenced.length <= 40);
  assert.equal((fenced.match(/```/g) ?? []).length % 2, 0);
});
