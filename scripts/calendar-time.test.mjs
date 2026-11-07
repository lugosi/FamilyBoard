// node --test scripts/calendar-time.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultEndFromStart, toFamilyLocalDateTime } from "../src/lib/calendar-time.ts";

test("toFamilyLocalDateTime keeps wall-clock and strips mistaken Z/offsets", () => {
  assert.equal(toFamilyLocalDateTime("2026-11-14T09:00"), "2026-11-14T09:00:00");
  assert.equal(toFamilyLocalDateTime("2026-11-14T09:00:00"), "2026-11-14T09:00:00");
  assert.equal(toFamilyLocalDateTime("2026-11-14T09:00:00Z"), "2026-11-14T09:00:00");
  assert.equal(toFamilyLocalDateTime("2026-11-14T09:00:00-08:00"), "2026-11-14T09:00:00");
  assert.equal(toFamilyLocalDateTime("2026-11-14T09:00:00.000+00:00"), "2026-11-14T09:00:00");
  assert.throws(() => toFamilyLocalDateTime("Nov 14 9am"));
});

test("defaultEndFromStart adds one hour and rolls past midnight", () => {
  assert.equal(defaultEndFromStart("2026-11-14T09:00"), "2026-11-14T10:00:00");
  assert.equal(defaultEndFromStart("2026-11-14T23:30"), "2026-11-15T00:30:00");
});
