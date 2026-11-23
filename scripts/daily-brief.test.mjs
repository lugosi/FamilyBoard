// node --test scripts/daily-brief.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  dateKeyInZone,
  formatMorningBrief,
  parseSlackUserIdList,
  shouldSendDailyBrief,
  zonedClockParts,
} from "../src/lib/daily-brief-format.ts";

test("shouldSendDailyBrief fires once after local target time", () => {
  const tz = "America/Los_Angeles";
  // 2026-11-19 07:00 PST = 15:00 UTC
  const atSeven = new Date("2026-11-19T15:00:00.000Z");
  assert.equal(dateKeyInZone(atSeven, tz), "2026-11-19");
  assert.equal(zonedClockParts(atSeven, tz).hour, 7);
  assert.equal(
    shouldSendDailyBrief(atSeven, {
      timeZone: tz,
      hour: 7,
      minute: 0,
      lastSentDateKey: null,
    }),
    true,
  );
  assert.equal(
    shouldSendDailyBrief(atSeven, {
      timeZone: tz,
      hour: 7,
      minute: 0,
      lastSentDateKey: "2026-11-19",
    }),
    false,
  );
  // 06:59 PST
  const before = new Date("2026-11-19T14:59:00.000Z");
  assert.equal(
    shouldSendDailyBrief(before, {
      timeZone: tz,
      hour: 7,
      minute: 0,
      lastSentDateKey: null,
    }),
    false,
  );
  // Catch-up later the same day
  const noon = new Date("2026-11-19T20:00:00.000Z");
  assert.equal(
    shouldSendDailyBrief(noon, {
      timeZone: tz,
      hour: 7,
      minute: 0,
      lastSentDateKey: null,
    }),
    true,
  );
});

test("formatMorningBrief includes calendar weather todos and house", () => {
  const text = formatMorningBrief(
    {
      dateKey: "2026-11-19",
      timeZone: "America/Los_Angeles",
      headline: "Good morning · Wednesday, November 19",
      weatherLine: "55°F now · high 62° / low 48°",
      events: [
        {
          summary: "School drop-off",
          start: "2026-11-19T08:15:00-08:00",
          location: "Emerson",
        },
        { summary: "Holiday", start: "2026-11-19", allDay: true },
      ],
      todos: [{ title: "Pack lunches", dueHint: "morning" }],
      houseAttention: [{ title: "Litter box", status: "Needs attention · Change bag" }],
    },
    "slack",
  );
  assert.match(text, /\*Good morning/);
  assert.match(text, /55°F now/);
  assert.match(text, /School drop-off/);
  assert.match(text, /Emerson/);
  assert.match(text, /all day — Holiday/);
  assert.match(text, /Pack lunches/);
  assert.match(text, /Litter box/);
});

test("parseSlackUserIdList accepts comma lists", () => {
  assert.deepEqual(parseSlackUserIdList("U123ABC, u456def ;U789"), [
    "U123ABC",
    "U456DEF",
    "U789",
  ]);
  assert.deepEqual(parseSlackUserIdList(""), []);
});

test("background jobs start the daily brief ticker", () => {
  const src = readFileSync(new URL("../src/lib/background.ts", import.meta.url), "utf8");
  assert.match(src, /startDailyBriefTicker/);
  assert.match(src, /tickDailyBrief/);
  assert.match(src, /Scheduled checks/);
});

test("morning brief is a built-in scheduled check", () => {
  const store = readFileSync(
    new URL("../src/lib/agent-monitors-store.ts", import.meta.url),
    "utf8",
  );
  assert.match(store, /MORNING_BRIEF_MONITOR_ID/);
  assert.match(store, /ensureMorningBriefMonitor/);
  const monitors = readFileSync(
    new URL("../src/lib/agent-monitors.ts", import.meta.url),
    "utf8",
  );
  assert.match(monitors, /morning-brief/);
  assert.match(monitors, /runMorningBriefMonitor|runDailyBrief/);
});
