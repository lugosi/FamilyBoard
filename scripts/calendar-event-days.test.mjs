import test from "node:test";
import assert from "node:assert/strict";
import { eventInclusiveDateKeys } from "../src/lib/calendar-layout.ts";

test("all-day multi-day event lists each inclusive day", () => {
  const keys = eventInclusiveDateKeys({
    start: { date: "2026-11-10" },
    end: { date: "2026-11-13" }, // Google exclusive end
  });
  assert.deepEqual(keys, ["2026-11-10", "2026-11-11", "2026-11-12"]);
});

test("single all-day event is one day", () => {
  const keys = eventInclusiveDateKeys({
    start: { date: "2026-11-10" },
    end: { date: "2026-11-11" },
  });
  assert.deepEqual(keys, ["2026-11-10"]);
});

test("overnight timed event covers both local days", () => {
  const keys = eventInclusiveDateKeys({
    start: { dateTime: "2026-11-10T22:00:00" },
    end: { dateTime: "2026-11-11T02:00:00" },
  });
  assert.deepEqual(keys, ["2026-11-10", "2026-11-11"]);
});

test("same-day timed event is one day", () => {
  const keys = eventInclusiveDateKeys({
    start: { dateTime: "2026-11-10T15:00:00" },
    end: { dateTime: "2026-11-10T16:00:00" },
  });
  assert.deepEqual(keys, ["2026-11-10"]);
});
