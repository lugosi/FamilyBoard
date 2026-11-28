// node --test scripts/cron.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cronForSchedulePreset,
  cronMatches,
  cronSlotKey,
  dueCronSlot,
  describeCron,
  isValidCron,
  parseCron,
  schedulePresetForCron,
  zonedCronParts,
} from "../src/lib/cron.ts";

test("parseCron accepts standard 5-field forms", () => {
  assert.ok(parseCron("0 7 * * *"));
  assert.ok(parseCron("*/15 * * * *"));
  assert.ok(parseCron("0 9 * * 1-5"));
  assert.ok(parseCron("0,30 8 * * 1,3,5"));
  assert.equal(isValidCron("not cron"), false);
  assert.equal(isValidCron("0 7 * *"), false);
  assert.equal(isValidCron("60 7 * * *"), false);
});

test("cronMatches daily 7:00 and weekday mornings", () => {
  const seven = { minute: 0, hour: 7, dayOfMonth: 19, month: 11, dayOfWeek: 4 };
  assert.equal(cronMatches("0 7 * * *", seven), true);
  assert.equal(cronMatches("0 8 * * *", seven), false);
  assert.equal(cronMatches("0 7 * * 1-5", seven), true); // Thu
  assert.equal(cronMatches("0 7 * * 6,0", seven), false);
});

test("cronMatches step and Sunday alias 7", () => {
  const parts = { minute: 15, hour: 10, dayOfMonth: 1, month: 1, dayOfWeek: 0 };
  assert.equal(cronMatches("*/15 10 * * 0", parts), true);
  assert.equal(cronMatches("*/15 10 * * 7", parts), true);
  assert.equal(cronMatches("5/15 10 * * 0", parts), false);
});

test("zonedCronParts + slot key are stable in Pacific", () => {
  const tz = "America/Los_Angeles";
  // 2026-11-19 07:00 PST = 15:00 UTC
  const atSeven = new Date("2026-11-19T15:00:00.000Z");
  const parts = zonedCronParts(atSeven, tz);
  assert.equal(parts.hour, 7);
  assert.equal(parts.minute, 0);
  assert.equal(parts.dayOfWeek, 4); // Thursday
  assert.equal(cronSlotKey(atSeven, tz), "2026-11-19T07:00");
});

test("dueCronSlot catches a missed morning minute and does not repeat it", () => {
  const tz = "America/Los_Angeles";
  // 2026-11-19 09:40 PST
  const atNineForty = new Date("2026-11-19T17:40:00.000Z");
  assert.equal(dueCronSlot("0 9 * * *", atNineForty, tz, null, null), "2026-11-19T09:00");
  assert.equal(
    dueCronSlot("0 9 * * *", atNineForty, tz, "2026-11-19T09:00", null),
    null,
  );
  // Created at 09:10, after this morning's slot — don't run yesterday's either.
  assert.equal(
    dueCronSlot("0 9 * * *", atNineForty, tz, null, "2026-11-19T09:10"),
    null,
  );
  // 08:00 PST, monitor created this morning: yesterday's 09:00 is before it existed.
  const atEight = new Date("2026-11-19T16:00:00.000Z");
  assert.equal(dueCronSlot("0 9 * * *", atEight, tz, null, "2026-11-19T08:00"), null);
});

test("describeCron covers common shapes", () => {
  assert.equal(describeCron("0 9 * * *"), "Every morning");
  assert.equal(describeCron("0 9 * * 1-5"), "Weekday mornings");
  assert.equal(describeCron("0 * * * *"), "Every hour");
  assert.equal(describeCron("0 */6 * * *"), "A few times a day");
  assert.equal(describeCron("0 7 * * *"), "7:00 morning");
  assert.equal(describeCron("0 8 * * *"), "daily at 8 AM");
  assert.equal(describeCron("* * * * *"), "every minute");
});

test("schedule presets map to cron and back", () => {
  assert.equal(cronForSchedulePreset("daily-morning"), "0 9 * * *");
  assert.equal(cronForSchedulePreset("early-morning"), "0 7 * * *");
  assert.equal(schedulePresetForCron("0 9 * * *"), "daily-morning");
  assert.equal(schedulePresetForCron("0 7 * * *"), "early-morning");
});
