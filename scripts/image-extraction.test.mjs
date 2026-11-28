// node --test scripts/image-extraction.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  correctReading,
  findReading,
  hashImageData,
  IMAGE_READING_TTL_MS,
  IMAGE_REPLY_SCRUBBED,
  imageReadingScope,
  pruneReadings,
  readingsPrompt,
  scrubImageTurnReplies,
  upsertReading,
} from "../src/lib/image-extraction-format.ts";

const NOW = 1_800_000_000_000;
const entry = (over = {}) => ({
  scope: "board",
  sha256: hashImageData(Buffer.from("a").toString("base64")),
  name: "flyer.jpg",
  mimeType: "image/jpeg",
  text: "Soccer Sat 9am",
  corrected: false,
  createdAt: NOW,
  expiresAt: NOW + IMAGE_READING_TTL_MS,
  ...over,
});

test("hash is over decoded bytes and scopes separate board from slack", () => {
  assert.equal(hashImageData(Buffer.from("a").toString("base64")).length, 64);
  assert.equal(imageReadingScope("board"), "board");
  assert.equal(imageReadingScope("slack", "k1"), "slack:k1");
});

test("readings expire after one day", () => {
  const e = entry();
  assert.equal(pruneReadings([e], NOW + IMAGE_READING_TTL_MS - 1).length, 1);
  assert.equal(pruneReadings([e], NOW + IMAGE_READING_TTL_MS).length, 0);
  assert.equal(findReading([e], "board", e.sha256, NOW + IMAGE_READING_TTL_MS), null);
  assert.ok(findReading([e], "board", e.sha256, NOW));
  assert.equal(findReading([e], "slack:x", e.sha256, NOW), null);
});

test("upsert replaces the same scope+hash and drops expired entries", () => {
  const stale = entry({ sha256: "old", expiresAt: NOW - 1 });
  const out = upsertReading([stale, entry()], entry({ text: "new" }), NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "new");
});

test("correction updates text, marks corrected, keeps the original expiry", () => {
  const e = entry();
  const { entries, entry: fixed } = correctReading([e], "board", "FLYER.jpg", " Soccer Sat 10am ", NOW + 5);
  assert.equal(fixed.text, "Soccer Sat 10am");
  assert.equal(fixed.corrected, true);
  assert.equal(fixed.expiresAt, e.expiresAt);
  assert.equal(entries[0], fixed);
  assert.equal(correctReading([e], "slack:x", undefined, "x", NOW).entry, null);
  assert.equal(correctReading([e], "board", undefined, "x", e.expiresAt).entry, null);
});

test("prompt marks corrected readings and never invites quoting", () => {
  const prompt = readingsPrompt([entry({ corrected: true })]);
  assert.match(prompt, /corrected by the family/);
  assert.match(prompt, /never quote/);
});

test("replies to image turns are scrubbed; other turns are untouched", () => {
  const turns = [
    { role: "user", content: "add this", attachments: [{ kind: "image" }] },
    { role: "model", content: "Soccer Sat 9am at Field 3", quickActions: [{ id: "x" }] },
    { role: "user", content: "thanks", attachments: [{ kind: "text" }] },
    { role: "model", content: "ok" },
  ];
  const out = scrubImageTurnReplies(turns);
  assert.equal(out[1].content, IMAGE_REPLY_SCRUBBED);
  assert.equal("quickActions" in out[1], false);
  assert.equal(out[3].content, "ok");
  assert.equal(out[0].content, "add this");
});
