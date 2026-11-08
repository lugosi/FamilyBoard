import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPendingSummary,
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
