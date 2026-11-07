// node --test scripts/wiki-format.test.mjs  (Node 22.18+ strips the .ts types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWikiIndex,
  composeNewPage,
  editSection,
  existingWikiPath,
  newWikiPath,
  parseFrontmatter,
  pathForNewPage,
  searchPages,
  toWikiPage,
  withChanges,
} from "../src/lib/wiki-format.ts";

const MAYA = `---
title: Maya
summary: "Maya's sizes, school, and allergies"
tags: [kids, school]
updated: 2026-10-01
owner: mom
---

# Maya

Born 2016.

## Sizes

- Shoes: 2
- Shirt: 10

## Allergies

Peanuts (EpiPen in the blue bag).

\`\`\`
## not a heading
\`\`\`

## School

Washington Elementary, room 12.
`;

test("parses frontmatter and keeps unknown keys", () => {
  const p = parseFrontmatter(MAYA);
  assert.equal(p.meta.title, "Maya");
  assert.equal(p.meta.summary, "Maya's sizes, school, and allergies");
  assert.deepEqual(p.meta.tags, ["kids", "school"]);
  assert.deepEqual(p.extra, ["owner: mom"]);
  assert.match(p.body, /^\n# Maya/);
});

test("parses block-style tag lists", () => {
  const p = parseFrontmatter("---\ntags:\n  - Wi Fi\n  - house\n---\nbody");
  assert.deepEqual(p.meta.tags, ["wi-fi", "house"]);
  assert.equal(p.body, "body");
});

test("pages without frontmatter derive title and summary", () => {
  const page = toWikiPage("recipes/pancakes.md", "# Pancakes\n\nMakes **8** fluffy pancakes.\n\n- flour");
  assert.equal(page.title, "Pancakes");
  assert.equal(page.summary, "Makes 8 fluffy pancakes.");
  assert.equal(page.category, "recipes");
  assert.deepEqual(toWikiPage("pancakes.md", "").title, "Pancakes");
  assert.equal(toWikiPage("pancakes.md", "").category, "");
});

test("append to a list section keeps the list contiguous", () => {
  const { body, created } = editSection(parseFrontmatter(MAYA).body, "sizes", "- Pants: 10", "append");
  assert.equal(created, false);
  assert.match(body, /- Shirt: 10\n- Pants: 10\n\n## Allergies/);
});

test("append prose adds a paragraph before the next heading", () => {
  const { body } = editSection(parseFrontmatter(MAYA).body, "Allergies", "Mild cat allergy.", "append");
  assert.match(body, /```\n\nMild cat allergy\.\n\n## School/);
});

test("replace swaps only that section and ignores headings in code fences", () => {
  const { body, heading } = editSection(parseFrontmatter(MAYA).body, "## Allergies", "## Allergies\n\nNone known.", "replace");
  assert.equal(heading, "Allergies");
  assert.doesNotMatch(body, /Peanuts/);
  assert.doesNotMatch(body, /not a heading\n```\n\n## School[\s\S]*not a heading/);
  assert.match(body, /## Allergies\n\nNone known\.\n\n## School/);
  assert.match(body, /## Sizes\n\n- Shoes: 2/);
});

test("missing section is created at the end; fuzzy match finds unique heading", () => {
  const created = editSection("# Wifi\n\nNetwork: Home", "Guest network", "Password on the fridge", "append");
  assert.equal(created.created, true);
  assert.match(created.body, /Network: Home\n\n## Guest network\n\nPassword on the fridge\n$/);
  const fuzzy = editSection(parseFrontmatter(MAYA).body, "school", "Teacher: Ms. Park", "append");
  assert.equal(fuzzy.heading, "School");
  assert.match(fuzzy.body, /room 12\.\n\nTeacher: Ms\. Park\n$/);
});

test("append without a section goes to the end; replace requires one", () => {
  assert.match(editSection("# A\n\n- one", "", "- two", "append").body, /- one\n- two\n$/);
  assert.throws(() => editSection("# A", "", "x", "replace"));
  assert.throws(() => editSection("# A", "A", "   ", "append"));
});

test("withChanges stamps updated and preserves extra frontmatter", () => {
  const out = withChanges(MAYA, { updated: "2026-11-06", meta: { tags: ["kids", "school", "health"] } });
  const p = parseFrontmatter(out);
  assert.equal(p.meta.updated, "2026-11-06");
  assert.deepEqual(p.meta.tags, ["kids", "school", "health"]);
  assert.deepEqual(p.extra, ["owner: mom"]);
  assert.equal(p.meta.summary, "Maya's sizes, school, and allergies");
});

test("composeNewPage writes the template", () => {
  const out = composeNewPage({ title: "Wi-Fi", summary: "Network: home: 5G", tags: ["House"], body: "SSID `home`", updated: "2026-11-06" });
  assert.equal(
    out,
    '---\ntitle: Wi-Fi\nsummary: "Network: home: 5G"\ntags: [house]\nupdated: 2026-11-06\n---\n\n# Wi-Fi\n\nSSID `home`\n',
  );
  assert.equal(parseFrontmatter(out).meta.summary, "Network: home: 5G");
});

test("paths: new pages are slugified, existing paths keep case, traversal is rejected", () => {
  assert.equal(pathForNewPage("People", "Grandma Rosa's Info"), "people/grandma-rosa-s-info.md");
  assert.equal(pathForNewPage(undefined, "Misc"), "notes/misc.md");
  assert.equal(newWikiPath("wiki/House/Wi Fi.md", "wiki"), "house/wi-fi.md");
  assert.equal(existingWikiPath("/wiki/Recipes/Pancakes", "wiki"), "Recipes/Pancakes.md");
  assert.throws(() => existingWikiPath("../secrets.md", "wiki"));
  assert.throws(() => existingWikiPath("a/.git/config", "wiki"));
  assert.throws(() => newWikiPath("a/b/c/d.md"));
  assert.throws(() => pathForNewPage("people", "!!!"));
});

test("search ranks title/tag hits, matches body text, and returns snippets", () => {
  const pages = [
    toWikiPage("people/maya.md", MAYA, "s1"),
    toWikiPage("house/wifi.md", "# Wi-Fi\n\nGuest password is on the fridge.", "s2"),
    toWikiPage("recipes/pb-cookies.md", "# Cookies\n\nContains peanuts.", "s3"),
  ];
  const r = searchPages(pages, "What are Maya's allergies?");
  assert.equal(r[0].path, "people/maya.md");
  assert.match(r[0].snippet, /Allergies|Peanuts/);
  const pw = searchPages(pages, "wifi password");
  assert.equal(pw[0].path, "house/wifi.md");
  assert.equal(pw[0].snippet, "Guest password is on the fridge.");
  assert.deepEqual(searchPages(pages, "peanuts", { category: "recipes" }).map((x) => x.path), ["recipes/pb-cookies.md"]);
  assert.deepEqual(searchPages(pages, "the and"), []);
});

test("index lists pages and truncates with a pointer to search", () => {
  const metas = Array.from({ length: 50 }, (_, i) => ({
    path: `notes/page-${String(i).padStart(2, "0")}.md`,
    title: `Page ${i}`,
    summary: "x".repeat(40),
    tags: ["a"],
    category: "notes",
    size: 10,
  }));
  const full = buildWikiIndex(metas.slice(0, 2));
  assert.equal(full.split("\n").length, 2);
  assert.match(full, /^- notes\/page-00\.md — Page 0: x+ \[a\]$/m);
  const cut = buildWikiIndex(metas, 500);
  assert.ok(cut.length < 600);
  assert.match(cut, /more page\(s\); use search_wiki/);
  assert.equal(buildWikiIndex([]), "(the wiki has no pages yet)");
});
