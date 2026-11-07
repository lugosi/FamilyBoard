import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHitsForPrompt } from "../src/lib/web-search.ts";

test("formatHitsForPrompt lists title, uri, snippet", () => {
  const text = formatHitsForPrompt([
    { title: "Warriors vs Lakers", uri: "https://example.com/g", snippet: "Final 112-108" },
  ]);
  assert.match(text, /^1\. Warriors vs Lakers\n   https:\/\/example\.com\/g\n   Final 112-108$/);
});
