// node --test scripts/chat-chart.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartsFromStravaSummary,
  extractChatChartsFromText,
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

test("parses dual-metric series as combo with axis legends", () => {
  const spec = parseChatChart(`{
    "type": "bar",
    "title": "Distance vs time",
    "leftAxisLabel": "Distance (km)",
    "rightAxisLabel": "Moving time (h)",
    "xAxisLabel": "Week",
    "series": [
      {"name": "Distance", "unit": "km", "data": [{"label": "W1", "value": 10}]},
      {"name": "Time", "unit": "h", "data": [{"label": "W1", "value": 1.2}]}
    ]
  }`);
  assert.ok(spec);
  assert.equal(spec.type, "combo");
  assert.equal(spec.series[0].unit, "km");
  assert.equal(spec.series[1].unit, "h");
  assert.equal(spec.leftAxisLabel, "Distance (km)");
  assert.equal(spec.rightAxisLabel, "Moving time (h)");
  assert.equal(spec.xAxisLabel, "Week");
});

test("rejects invalid charts", () => {
  assert.equal(parseChatChart(`{"type":"pie","data":[{"label":"a","value":1}]}`), null);
  assert.equal(parseChatChart(`not json`), null);
  assert.equal(parseChatChart(`{"type":"bar","data":[]}`), null);
});

test("strips chart fences from Slack text", () => {
  const out = stripChatChartFences(
    `Hello\n\`\`\`chart\n{"type":"bar","title":"Weekly km","data":[{"label":"W1","value":3}]}\n\`\`\`\nDone`,
    "remove",
  );
  assert.doesNotMatch(out, /```chart/);
  assert.match(out, /Hello/);
  assert.match(out, /Done/);
});

test("Strava summary builds combo bar+line charts with axis legends", () => {
  const charts = chartsFromStravaSummary({
    byWeek: [
      { weekStart: "2026-11-03", distance_m: 12000, moving_time_s: 3600 },
      { weekStart: "2026-11-10", distance_m: 18000, moving_time_s: 5400 },
    ],
    bySport: [
      { sport: "Run", distance_m: 20000, count: 4 },
      { sport: "Ride", distance_m: 10000, count: 2 },
    ],
  });
  assert.equal(charts.length, 2);
  assert.equal(charts[0].type, "combo");
  assert.equal(charts[0].series.length, 2);
  assert.equal(charts[0].series[0].unit, "km");
  assert.equal(charts[0].series[1].unit, "h");
  assert.match(charts[0].leftAxisLabel || "", /Distance/);
  assert.match(charts[0].rightAxisLabel || "", /Moving time/);
  assert.equal(charts[0].xAxisLabel, "Week starting");
  assert.equal(charts[1].type, "combo");
  assert.equal(charts[1].series[0].unit, "km");
  assert.equal(charts[1].series[1].unit, "n");
  assert.match(charts[1].leftAxisLabel || "", /Distance/);
  assert.match(charts[1].rightAxisLabel || "", /Sessions/);
  const out = injectChatCharts("Here is your week.", charts);
  assert.match(out, /```chart/);
  const extracted = extractChatChartsFromText(out);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].type, "combo");
});

test("combo SVG includes left and right axis legends", async () => {
  // tsx resolves extensionless TS imports the same way Next does.
  const { execFileSync } = await import("node:child_process");
  const script = `
    import { renderChatChartSvg } from "./src/lib/chat-chart-svg.ts";
    const svg = renderChatChartSvg({
      type: "combo",
      title: "Distance vs time",
      leftAxisLabel: "Distance (km)",
      rightAxisLabel: "Moving time (h)",
      xAxisLabel: "Week starting",
      series: [
        { name: "Distance", unit: "km", color: "#38bdf8",
          data: [{ label: "11-03", value: 12 }, { label: "11-10", value: 18 }] },
        { name: "Moving time", unit: "h", color: "#fbbf24",
          data: [{ label: "11-03", value: 1 }, { label: "11-10", value: 1.5 }] },
      ],
    }, { theme: "light" });
    if (!/Distance \\(km\\)/.test(svg)) throw new Error("missing left axis");
    if (!/Moving time \\(h\\)/.test(svg)) throw new Error("missing right axis");
    if (!/Week starting/.test(svg)) throw new Error("missing x axis");
    if (!/<rect /.test(svg)) throw new Error("missing bars");
    if (!/<path /.test(svg)) throw new Error("missing line");
    if (!/<circle /.test(svg)) throw new Error("missing markers");
    console.log("ok");
  `;
  const out = execFileSync("npx", ["--yes", "tsx", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.match(out, /ok/);
});
