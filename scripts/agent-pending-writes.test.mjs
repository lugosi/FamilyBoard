import test from "node:test";
import assert from "node:assert/strict";
import {
  expireStaleApprovalsInTurns,
  formatPendingSummary,
  isPendingApprovalExpired,
  markApprovalResolvedInTurns,
  previewWriteLabel,
  WRITE_TOOLS_NEEDING_APPROVAL,
} from "../src/lib/agent-pending-writes-format.ts";

test("write tools set covers calendar + wiki mutations", () => {
  for (const name of [
    "create_event",
    "update_event",
    "delete_event",
    "create_wiki_page",
    "edit_wiki_section",
    "rewrite_wiki_page",
    "move_wiki_page",
    "delete_wiki_page",
    "save_skill",
  ]) {
    assert.equal(WRITE_TOOLS_NEEDING_APPROVAL.has(name), true, name);
  }
  assert.equal(WRITE_TOOLS_NEEDING_APPROVAL.has("find_events"), false);
  assert.equal(WRITE_TOOLS_NEEDING_APPROVAL.has("add_todo"), false);
});

test("preview labels and summary are readable", () => {
  const items = [
    {
      tool: "create_event",
      args: { summary: "Dentist", start: "2026-11-11T15:00" },
      label: previewWriteLabel(
        "create_event",
        { summary: "Dentist", start: "2026-11-11T15:00" },
        "America/Los_Angeles",
      ),
    },
    {
      tool: "edit_wiki_section",
      args: { path: "people/maya.md", section: "Sizes", mode: "append", text: "3" },
      label: previewWriteLabel(
        "edit_wiki_section",
        { path: "people/maya.md", section: "Sizes", mode: "append" },
        "America/Los_Angeles",
      ),
    },
  ];
  assert.match(items[0].label, /Dentist/);
  assert.match(items[1].label, /Sizes/);
  const summary = formatPendingSummary(items);
  assert.match(summary, /Calendar/);
  assert.match(summary, /Wiki/);
  assert.match(summary, /Dentist/);
});

test("formatPendingSummary can compact long bullet lists for Slack", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    tool: "create_event",
    args: {},
    label: `Add “Event ${i + 1}”`,
  }));
  const compact = formatPendingSummary(items, { maxBullets: 15 });
  assert.match(compact, /Calendar/);
  assert.match(compact, /Event 1/);
  assert.match(compact, /Event 15/);
  assert.doesNotMatch(compact, /Event 16/);
  assert.match(compact, /and 25 more \(Approve applies all 40\)/);
});

test("isPendingApprovalExpired uses expiresAt", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(isPendingApprovalExpired(past), true);
  assert.equal(isPendingApprovalExpired(future), false);
  assert.equal(isPendingApprovalExpired("not-a-date"), false);
});

test("expireStaleApprovalsInTurns marks unused past-TTL approvals", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const turns = [
    {
      role: "model",
      content: "staged",
      pendingApproval: {
        id: "old",
        summary: "Calendar\n• Add “Dentist”",
        items: [{ tool: "create_event", label: "Add “Dentist”" }],
        expiresAt: past,
      },
    },
    {
      role: "model",
      content: "still open",
      pendingApproval: {
        id: "fresh",
        summary: "Wiki\n• Create page",
        items: [{ tool: "create_wiki_page", label: "Create page" }],
        expiresAt: future,
      },
    },
    {
      role: "model",
      content: "already decided",
      pendingApproval: {
        id: "done",
        summary: "x",
        items: [],
        expiresAt: past,
      },
      approvalResolved: "approved",
    },
  ];
  const { turns: next, changed, expiredIds } = expireStaleApprovalsInTurns(turns);
  assert.equal(changed, true);
  assert.deepEqual(expiredIds, ["old"]);
  assert.equal(next[0].approvalResolved, "expired");
  assert.equal(next[1].approvalResolved, undefined);
  assert.equal(next[2].approvalResolved, "approved");
});

test("markApprovalResolvedInTurns stamps matching pending ids", () => {
  const turns = [
    {
      role: "user",
      content: "Add dentist",
    },
    {
      role: "model",
      content: "staged",
      pendingApproval: {
        id: "pend-1",
        summary: "Calendar\n• Add “Dentist”",
        items: [{ tool: "create_event", label: "Add “Dentist”" }],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    },
    {
      role: "model",
      content: "other",
      pendingApproval: {
        id: "pend-2",
        summary: "x",
        items: [],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    },
  ];
  const { turns: rejected, changed } = markApprovalResolvedInTurns(turns, "pend-1", "rejected");
  assert.equal(changed, true);
  assert.equal(rejected[1].approvalResolved, "rejected");
  assert.equal(rejected[2].approvalResolved, undefined);
  const again = markApprovalResolvedInTurns(rejected, "pend-1", "rejected");
  assert.equal(again.changed, false);
});
