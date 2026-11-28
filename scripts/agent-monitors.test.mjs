// node --test scripts/agent-monitors.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cronSlotKey, dueCronSlot } from "../src/lib/cron.ts";

const tz = "America/Los_Angeles";

test("price check created at 8:00 is still due at 9:40, and not again after it runs", () => {
  const now = new Date("2026-11-19T17:40:00.000Z");
  const createdSlot = cronSlotKey(new Date("2026-11-19T16:00:00.000Z"), tz);
  assert.equal(createdSlot, "2026-11-19T08:00");
  assert.equal(dueCronSlot("0 9 * * *", now, tz, null, createdSlot), "2026-11-19T09:00");
  assert.equal(dueCronSlot("0 9 * * *", now, tz, "2026-11-19T09:00", createdSlot), null);
});

test("a check created after this morning's slot waits until the next one", () => {
  const now = new Date("2026-11-19T17:40:00.000Z");
  const createdSlot = cronSlotKey(new Date("2026-11-19T17:10:00.000Z"), tz);
  assert.equal(dueCronSlot("0 9 * * *", now, tz, null, createdSlot), null);
});

test("scheduled prompt always reports, and a Slack send with nobody to message is an error", () => {
  const src = readFileSync(new URL("../src/lib/agent-monitors.ts", import.meta.url), "utf8");
  assert.match(src, /monitorDueSlot/);
  assert.match(src, /dueCronSlot/);
  assert.match(src, /Always answer in this reply/);
  assert.match(src, /no_slack_recipients/);
  assert.match(src, /Nothing new to report/);
  assert.match(src, /listSlackDeliveryTargets/);
  assert.match(src, /function monitorSlackRecipients/);
});
