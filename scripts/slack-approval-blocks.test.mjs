import test from "node:test";
import assert from "node:assert/strict";
import { pendingApprovalBlocks } from "../src/lib/slack.ts";

test("pendingApprovalBlocks exposes Approve and Deny action buttons", () => {
  const blocks = pendingApprovalBlocks("pend_abc", "Create event: Dentist Tue 3pm");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "section");
  assert.match(String(blocks[0].text?.text ?? ""), /Review before writing/);
  assert.match(String(blocks[0].text?.text ?? ""), /Dentist Tue 3pm/);

  const actions = blocks[1];
  assert.equal(actions.type, "actions");
  assert.equal(actions.block_id, "pending_pend_abc");
  const elements = actions.elements;
  assert.ok(Array.isArray(elements));
  assert.equal(elements.length, 2);

  const [approve, deny] = elements;
  assert.equal(approve.type, "button");
  assert.equal(approve.action_id, "familyboard_approve");
  assert.equal(approve.style, "primary");
  assert.equal(approve.value, "pend_abc");
  assert.equal(approve.text?.text, "Approve");

  assert.equal(deny.type, "button");
  assert.equal(deny.action_id, "familyboard_deny");
  assert.equal(deny.style, "danger");
  assert.equal(deny.value, "pend_abc");
  assert.equal(deny.text?.text, "Deny");
});

test("pendingApprovalBlocks escapes triple backticks in summary", () => {
  const blocks = pendingApprovalBlocks("x", "code ```oops``` here");
  assert.match(String(blocks[0].text?.text ?? ""), /'''oops'''/);
  assert.doesNotMatch(String(blocks[0].text?.text ?? ""), /```oops```/);
});
