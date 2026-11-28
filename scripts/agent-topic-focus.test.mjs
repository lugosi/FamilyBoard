// node --test scripts/agent-topic-focus.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { offTopicWikiWriteError, TOPIC_FOCUS_RULES } from "../src/lib/agent-topic-focus.ts";

const KART_TEXT =
  "- Race 2 Kart #67 32.958s at Culver City · created: 2026-11-20 · updated: 2026-11-20 · weight: 2";

const GTA_MESSAGE =
  "lugosi: In GTA the hotel only lets me manual save, and I think autosave overwrote my save before the hotel. What do I do?";

const thread = (latest) => [
  { role: "user", content: "lugosi: Log k1 kart #67 at 32.958 seconds, Culver City race 2" },
  { role: "assistant", content: "Logged." },
  { role: "user", content: latest },
];

test("rules say the latest message is the only task and the server rejects off-topic writes", () => {
  const blob = TOPIC_FOCUS_RULES.join("\n");
  assert.match(blob, /latest user message is the only task/);
  assert.match(blob, /new subject/);
  assert.match(blob, /server rejects a write/);
});

test("GTA message cannot write K1 kart text to wiki or .context", () => {
  const messages = thread(GTA_MESSAGE);
  assert.match(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: "notes/k1-speed-race-results.md",
      section: "Results",
      text: KART_TEXT,
      mode: "append",
    }) ?? "",
    /Blocked/,
  );
  assert.match(
    offTopicWikiWriteError(messages, "create_wiki_page", {
      category: "notes",
      title: "K1 speed race results",
      summary: "Kart race laps",
      body: `## Results\n${KART_TEXT}`,
    }) ?? "",
    /Blocked/,
  );
  assert.match(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: ".context/U123/afternoon-delight.md",
      section: "Facts",
      text: KART_TEXT,
      mode: "append",
    }) ?? "",
    /Blocked/,
  );
});

test("GTA message can append a note about the hotel script and autosave to open-loops", () => {
  const messages = thread(GTA_MESSAGE);
  assert.equal(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: ".context/U123/open-loops.md",
      section: "Active",
      text: "- GTA hotel script: manual save only, autosave hotel problem",
      mode: "append",
    }),
    undefined,
  );
});

test("afternoon delight mission rejects kart laps but allows its own note", () => {
  const messages = thread("lugosi: Doing afternoon delight mission now");
  assert.match(
    offTopicWikiWriteError(messages, "create_wiki_page", {
      category: ".context/U123",
      title: "afternoon-delight",
      summary: "Mission notes",
      body: `## Facts\n${KART_TEXT}`,
    }) ?? "",
    /Blocked/,
  );
  assert.equal(
    offTopicWikiWriteError(messages, "create_wiki_page", {
      category: ".context/U123",
      title: "afternoon-delight",
      summary: "Mission",
      body: "## Facts\nStarted the afternoon delight mission.",
    }),
    undefined,
  );
});

test("k1 kart log allows its own note", () => {
  const messages = [{ role: "user", content: "lugosi: Log k1 kart #9 at 34.376 seconds" }];
  assert.equal(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: "notes/k1.md",
      section: "Results",
      text: "Kart #9: 34.376s best lap.",
      mode: "append",
    }),
    undefined,
  );
});

test("short follow-up allows the kart text", () => {
  const messages = thread("lugosi: yes, save that");
  assert.equal(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: "notes/k1-speed-race-results.md",
      section: "Results",
      text: KART_TEXT,
      mode: "append",
    }),
    undefined,
  );
});

test("a question about a new subject still blocks the kart text", () => {
  const messages = thread("I don't have a manual save before the hotel. What should I do?");
  assert.match(
    offTopicWikiWriteError(messages, "edit_wiki_section", {
      path: "notes/k1-speed-race-results.md",
      section: "Results",
      text: KART_TEXT,
      mode: "append",
    }) ?? "",
    /Blocked/,
  );
});

test("create_event is not gated", () => {
  assert.equal(
    offTopicWikiWriteError(thread(GTA_MESSAGE), "create_event", {
      title: "Kart race",
      start: "2026-11-29T10:00",
    }),
    undefined,
  );
});

test("agent.ts wires topic focus and drops the always-write-back wording", () => {
  const agent = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /TOPIC_FOCUS_RULES/);
  assert.match(agent, /offTopicWikiWriteError/);
  assert.doesNotMatch(agent, /Skipping write-back is a bug/);
  assert.doesNotMatch(agent, /MUST have called a silent/);
});
