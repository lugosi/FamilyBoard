import test from "node:test";
import assert from "node:assert/strict";
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
