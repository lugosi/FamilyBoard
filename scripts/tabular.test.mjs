// node --test scripts/tabular.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentsToPrompt,
  imageAttachments,
  imagePromptNote,
  formatSheetDate,
  gridsToAttachment,
  parseDelimited,
  rowsToCsv,
  truncateLines,
} from "../src/lib/tabular.ts";
import { composeSkillPage, parseFrontmatter, toWikiPage } from "../src/lib/wiki-format.ts";

test("parseDelimited handles quotes, embedded commas/newlines, CRLF and BOM", () => {
  const rows = parseDelimited('\uFEFFDate,Opponent,Notes\r\n2026-11-14,"Tigers, U10","Bring ""orange"" jersey\nand water"\r\n');
  assert.deepEqual(rows, [
    ["Date", "Opponent", "Notes"],
    ["2026-11-14", "Tigers, U10", 'Bring "orange" jersey\nand water'],
  ]);
  assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
});

test("rowsToCsv drops empty rows and trailing empty cells, quotes when needed", () => {
  const { csv, rowCount } = rowsToCsv([["a", "b", "", ""], ["", ""], ['x,y', 'say "hi"']]);
  assert.equal(csv, 'a,b\n"x,y","say ""hi"""');
  assert.equal(rowCount, 2);
});

test("gridsToAttachment summarizes single and multi-sheet workbooks", () => {
  const one = gridsToAttachment("games.csv", [{ name: "games.csv", rows: [["Date"], ["2026-11-14"]] }]);
  assert.equal(one.summary, "2 rows");
  assert.equal(one.text, "Date\n2026-11-14");
  const two = gridsToAttachment("book.xlsx", [
    { name: "Fall", rows: [["Date"], ["x"]] },
    { name: "Empty", rows: [] },
    { name: "Spring", rows: [["Date"]] },
  ]);
  assert.equal(two.summary, "2 sheets, 3 rows");
  assert.match(two.text, /^## Sheet: Fall \(2 rows\)\nDate\nx\n\n## Sheet: Spring \(1 rows\)\nDate$/);
});

test("truncateLines cuts at a line boundary and reports what was dropped", () => {
  const text = Array.from({ length: 100 }, (_, i) => `row ${i}`).join("\n");
  const out = truncateLines(text, 50);
  assert.equal(out.truncated, true);
  assert.ok(out.text.length < 120);
  assert.match(out.text, /row 7\n…\(truncated: \d+ more line\(s\) not shown\)$/);
  assert.equal(truncateLines("short").truncated, false);
});

test("formatSheetDate keeps the sheet's wall-clock value", () => {
  assert.equal(formatSheetDate(new Date(Date.UTC(2026, 10, 14))), "2026-11-14");
  assert.equal(formatSheetDate(new Date(Date.UTC(2026, 10, 14, 9, 30))), "2026-11-14 09:30");
  assert.equal(formatSheetDate(new Date(Date.UTC(1899, 11, 30, 17, 15))), "17:15");
});

test("attachmentsToPrompt labels the block and avoids fence collisions", () => {
  const p = attachmentsToPrompt([{ name: "a.csv", kind: "sheet", summary: "2 rows", text: "x,y" }]);
  assert.equal(p, '[Attached spreadsheet "a.csv" (2 rows)]\n```csv\nx,y\n```');
  const md = attachmentsToPrompt([{ name: "n.md", kind: "text", summary: "1 line", text: "```js\n```" }]);
  assert.match(md, /^\[Attached file "n\.md" \(1 line\)\]\n~~~~\n/);
});

test("composeSkillPage writes the skill template", () => {
  const page = composeSkillPage({
    name: "Soccer schedule to calendar",
    whenToUse: "Someone shares the U10 soccer schedule (sheet or file).\nUsually each season.",
    inputs: "Columns: Date, Time, Opponent, Field",
    steps: ["1. Read the sheet with read_google_sheet", "- Call find_events for the season to skip duplicates", "Create one event per game:\ntitle “Soccer vs <Opponent>”"],
    notes: "Games are 1 hour.",
    tags: ["Soccer", "calendar"],
    updated: "2026-11-06",
  });
  const parsed = parseFrontmatter(page);
  assert.equal(parsed.meta.summary, "Someone shares the U10 soccer schedule (sheet or file).");
  assert.deepEqual(parsed.meta.tags, ["skill", "soccer", "calendar"]);
  assert.match(page, /## Steps\n\n1\. Read the sheet with read_google_sheet\n2\. Call find_events for the season to skip duplicates\n3\. Create one event per game:\n   title “Soccer vs <Opponent>”\n\n## Notes\n\nGames are 1 hour\.\n$/);
  assert.equal(toWikiPage("skills/soccer.md", page).title, "Soccer schedule to calendar");
  assert.throws(() => composeSkillPage({ name: "x", whenToUse: "y", steps: [" "], updated: "d" }));
});

test("image attachments are labeled, not inlined as text", () => {
  const imgs = [{ name: "photo.jpg", kind: "image", summary: "12 KB · jpeg", text: "", mimeType: "image/jpeg", data: "abc" }];
  assert.equal(attachmentsToPrompt(imgs), "");
  assert.equal(imagePromptNote(imgs), '[Attached image "photo.jpg" (12 KB · jpeg)]');
  assert.deepEqual(imageAttachments(imgs), [{ name: "photo.jpg", mimeType: "image/jpeg", data: "abc" }]);
});
