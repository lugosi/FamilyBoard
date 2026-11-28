// node --test scripts/agent-wiki-reads.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkRewriteWikiRead,
  lookupWikiRead,
  normalizeWikiReadKey,
  recordWikiRead,
  restoreWikiReadsMap,
} from "../src/lib/agent-wiki-reads.ts";

test("normalizeWikiReadKey matches repo basePath, slash, case, extension, and .context variants", () => {
  const canonical = "notes/k1-speed-race-results";
  assert.equal(normalizeWikiReadKey("notes/k1-speed-race-results.md", "wiki"), canonical);
  assert.equal(normalizeWikiReadKey("notes/k1-speed-race-results", "wiki"), canonical);
  assert.equal(normalizeWikiReadKey("/Notes/K1-Speed-Race-Results.MD/", "wiki"), canonical);
  assert.equal(normalizeWikiReadKey("wiki/notes/k1-speed-race-results.md", "wiki"), canonical);
  assert.equal(normalizeWikiReadKey("./wiki/notes//k1-speed-race-results.md", "wiki"), canonical);
  assert.equal(normalizeWikiReadKey("notes\\k1-speed-race-results.md", "wiki"), canonical);
  assert.equal(
    normalizeWikiReadKey("context/U012ABCDEF/pets.md", "wiki"),
    ".context/u012abcdef/pets",
  );
  assert.equal(
    normalizeWikiReadKey(".context/U012ABCDEF/pets.md", "wiki"),
    ".context/u012abcdef/pets",
  );
});

test("failing sequence: unread page is rejected before staging with actionable guidance, then succeeds after fresh read", () => {
  // Turn 1 read `notes/k1-speed-race-results.md`, then Turn 2 begins with a fresh empty map.
  const turn2Reads = new Map();

  // Round 1 of Turn 2: model attempts rewrite_wiki_page without re-reading first.
  const firstAttempt = checkRewriteWikiRead(turn2Reads, "notes/k1-speed-race-results.md", "wiki");
  assert.equal(firstAttempt.ok, false);
  if (!firstAttempt.ok) {
    assert.match(firstAttempt.error, /read_wiki_page\("notes\/k1-speed-race-results\.md"\)/);
    assert.match(firstAttempt.error, /retry rewrite_wiki_page/i);
    assert.match(firstAttempt.error, /edit_wiki_section/);
  }

  // Round 2 of Turn 2: model calls read_wiki_page and records fresh sha.
  recordWikiRead(turn2Reads, "notes/k1-speed-race-results.md", "sha-fresh-123", "wiki");

  // Round 3 of Turn 2: model retries rewrite_wiki_page (even with wiki/ prefix or omitted .md).
  const retry = checkRewriteWikiRead(turn2Reads, "wiki/notes/k1-speed-race-results", "wiki");
  assert.equal(retry.ok, true);
  if (retry.ok) {
    assert.equal(retry.read.path, "notes/k1-speed-race-results.md");
    assert.equal(retry.read.sha, "sha-fresh-123");
  }

  // Pending approval persists Object.fromEntries(wikiReads) and restores on Approve.
  const persisted = Object.fromEntries(turn2Reads);
  const approveReads = restoreWikiReadsMap(persisted, "wiki");
  const onApprove = checkRewriteWikiRead(approveReads, "notes/k1-speed-race-results.md", "wiki");
  assert.equal(onApprove.ok, true);
  if (onApprove.ok) {
    assert.equal(onApprove.read.sha, "sha-fresh-123");
  }
});

test("same-round parallel [read_wiki_page, rewrite_wiki_page] is blocked until the next round", () => {
  const ctxReads = new Map();
  // Round 1 snapshot is captured before processing any calls in the round.
  const readsBeforeRound1 = new Map(ctxReads);

  // read_wiki_page runs and mutates ctxReads, NOT readsBeforeRound1.
  recordWikiRead(ctxReads, "notes/k1-speed-race-results.md", "sha-1", "wiki");

  // rewrite_wiki_page in the SAME round checks readsBeforeRound1 -> blocked so model sees content first.
  const sameRound = checkRewriteWikiRead(
    readsBeforeRound1,
    "notes/k1-speed-race-results.md",
    "wiki",
  );
  assert.equal(sameRound.ok, false);

  // Round 2 snapshot now includes the read -> allowed.
  const readsBeforeRound2 = new Map(ctxReads);
  const nextRound = checkRewriteWikiRead(
    readsBeforeRound2,
    "notes/k1-speed-race-results.md",
    "wiki",
  );
  assert.equal(nextRound.ok, true);
});

test("missing sha is not recorded and empty path returns actionable error", () => {
  const reads = new Map();
  recordWikiRead(reads, "notes/k1-speed-race-results.md", undefined, "wiki");
  assert.equal(reads.size, 0);
  assert.equal(lookupWikiRead(reads, "notes/k1-speed-race-results.md", "wiki"), undefined);

  const empty = checkRewriteWikiRead(reads, "   ", "wiki");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /read_wiki_page/);
});

test("restoreWikiReadsMap handles undefined and legacy unnormalized persisted keys", () => {
  assert.equal(restoreWikiReadsMap(undefined, "wiki").size, 0);

  const restored = restoreWikiReadsMap(
    {
      "wiki/notes/k1-speed-race-results": {
        path: "notes/k1-speed-race-results.md",
        sha: "sha-legacy",
      },
    },
    "wiki",
  );
  const check = checkRewriteWikiRead(restored, "notes/k1-speed-race-results.md", "wiki");
  assert.equal(check.ok, true);
  if (check.ok) assert.equal(check.read.sha, "sha-legacy");
});

test("agent loop validates beforeStage before staging and rewrite_wiki_page wires the guard", () => {
  const agentSrc = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  const toolsSrc = readFileSync(new URL("../src/lib/agent-wiki-tools.ts", import.meta.url), "utf8");

  assert.match(agentSrc, /readsBeforeRound = new Map\(ctx\.wikiReads\)/);
  assert.match(agentSrc, /tool\.beforeStage\?\.\(args,\s*\{\s*\.\.\.ctx,\s*wikiReads:\s*readsBeforeRound\s*\}\)/);
  assert.match(agentSrc, /restoreWikiReadsMap\(batch\.wikiReads/);

  const beforeStageIdx = agentSrc.indexOf("tool.beforeStage?.");
  const stagedPushIdx = agentSrc.indexOf("staged.push(");
  assert.ok(beforeStageIdx > 0 && stagedPushIdx > beforeStageIdx, "beforeStage must run before staged.push");

  assert.match(toolsSrc, /name:\s*"rewrite_wiki_page"/);
  assert.match(toolsSrc, /beforeStage\(args,\s*ctx\)/);
  assert.match(toolsSrc, /checkRewriteWikiRead\(/);
  assert.match(toolsSrc, /recordWikiRead\(/);
});
