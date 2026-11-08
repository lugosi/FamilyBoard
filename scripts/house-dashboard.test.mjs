// node --test scripts/house-dashboard.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHouseDashboardText } from "../src/lib/house-dashboard-format.ts";

const sample = {
  asOf: "Sun 12:40 PM",
  panels: [
    { id: "weather", title: "Outside", status: "62°F · 48% humidity" },
    {
      id: "lights",
      title: "Lights",
      status: "1 on · 2 off",
      detail: "On: Living room",
    },
    {
      id: "litter",
      title: "Litter box",
      status: "Needs attention · Change bag",
      attention: true,
    },
    { id: "music", title: "Music", status: "Idle" },
  ],
  quickActions: [
    { id: "catlink-change-bag", label: "Change bag", prompt: "Change the litter bag" },
    { id: "hue-off-living room", label: "Living room off", prompt: "Turn off Living room lights" },
  ],
};

test("Slack dashboard text is compact with actions", () => {
  const text = formatHouseDashboardText(sample, "slack");
  assert.match(text, /\*House · Sun 12:40 PM\*/);
  assert.match(text, /Litter box/);
  assert.match(text, /🔴/);
  assert.match(text, /Actions — reply with one/);
  assert.match(text, /Change bag/);
});

test("Board dashboard text uses markdown emphasis", () => {
  const text = formatHouseDashboardText(sample, "board");
  assert.match(text, /\*\*Litter box:\*\*/);
  assert.match(text, /⚠/);
  assert.doesNotMatch(text, /Actions — reply/);
});
