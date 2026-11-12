// node --test scripts/chat-chart.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartsFromStravaSummary,
  injectChatCharts,
  parseChatChart,
  stripChatChartFences,
} from "../src/lib/chat-chart.ts";

test("parses bar chart with data[]", () => {
  const spec = parseChatChart(`{
    "type": "bar",
    "title": "Weekly km",
    "unit": "km",
    "data": [{"label": "2026-11-03", "value": 12.4}, {"label": "2026-11-10", "value": 18}]
  }`);
  assert.ok(spec);
  assert.equal(spec.type, "bar");
  assert.equal(spec.unit, "km");
  assert.equal(spec.series.length, 1);
  assert.equal(spec.series[0].data.length, 2);
  assert.equal(spec.series[0].data[0].value, 12.4);
});

test("parses series[] and line type", () => {
  const spec = parseChatChart(`{
    "type": "line",
    "title": "Load",
    "series": [
      {"name": "Distance", "data": [{"label": "W1", "value": 10}, {"x": "W2", "y": 14}]}
    ]
  }`);
  assert.ok(spec);
  assert.equal(spec.type, "line");
  assert.equal(spec.series[0].data[1].label, "W2");
  assert.equal(spec.series[0].data[1].value, 14);
});

test("rejects invalid charts", () => {
  assert.equal(parseChatChart(`{"type":"pie","data":[{"label":"a","value":1}]}`), null);
  assert.equal(parseChatChart(`not json`), null);
  assert.equal(parseChatChart(`{"type":"bar","data":[]}`), null);
});

test("strips chart fences for Slack into Unicode bars", () => {
  const out = stripChatChartFences(
    `Hello\n\`\`\`chart\n{"type":"bar","title":"Weekly km","data":[{"label":"W1","value":3},{"label":"W2","value":6}]}\n\`\`\`\nDone`,
  );
  assert.match(out, /\*Weekly km\*/);
  assert.match(out, /W1/);
  assert.match(out, /█/);
  assert.doesNotMatch(out, /```chart/);
});

test("injects charts when the model omits fences", () => {
  const charts = chartsFromStravaSummary({
    byWeek: [
      { weekStart: "2026-11-03", distance_m: 12000 },
      { weekStart: "2026-11-10", distance_m: 18000 },
    ],
    bySport: [
      { sport: "Run", distance_m: 20000 },
      { sport: "Ride", distance_m: 10000 },
    ],
  });
  assert.equal(charts.length, 2);
  const out = injectChatCharts("Here is your week.", charts);
  assert.match(out, /Here is your week/);
  assert.match(out, /```chart/);
  assert.match(out, /Distance by week/);
  const again = injectChatCharts(out, charts);
  assert.equal(again, out);
});
