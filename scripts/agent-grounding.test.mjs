// node --test scripts/agent-grounding.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_GROUNDING_RULES } from "../src/lib/agent-grounding.ts";

test("AGENT_GROUNDING_RULES ban inventing missing documents and tool results", () => {
  assert.ok(AGENT_GROUNDING_RULES.length >= 3);
  const blob = AGENT_GROUNDING_RULES.join("\n");
  assert.match(blob, /Never invent/i);
  assert.match(blob, /don'?t have that document/i);
  assert.match(blob, /TRUNCATED/i);
  assert.match(blob, /search_wiki/i);
  assert.match(blob, /Do not fabricate/i);
});

test("agent system prompt spreads AGENT_GROUNDING_RULES", () => {
  const src = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(src, /from "\.\/agent-grounding"/);
  assert.match(src, /\.\.\.AGENT_GROUNDING_RULES/);
});
