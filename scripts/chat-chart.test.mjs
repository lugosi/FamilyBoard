// node --test scripts/chat-chart.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatChart, stripChatChartFences } from "../src/lib/chat-chart.ts";

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

test("strips chart fences for Slack", () => {
  const out = stripChatChartFences(
    `Hello\n\`\`\`chart\n{"type":"bar","title":"Weekly km","data":[{"label":"W1","value":3}]}\n\`\`\`\nDone`,
  );
  assert.match(out, /\*Weekly km\*/);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /W1/);
});
