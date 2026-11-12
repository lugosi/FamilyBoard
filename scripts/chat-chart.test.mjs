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

test("inject replaces model chart fences with tool combo charts", () => {
  const reply = `Here is your week.\n\`\`\`chart\n{"type":"bar","title":"Weekly km","data":[{"label":"W1","value":3}]}\n\`\`\``;
  const charts = chartsFromStravaSummary({
    byWeek: [
      { weekStart: "2026-11-03", distance_m: 12000, moving_time_s: 3600, suffer_score: 40 },
      { weekStart: "2026-11-10", distance_m: 18000, moving_time_s: 5400, suffer_score: 62 },
    ],
  });
  const out = injectChatCharts(reply, charts);
  assert.match(out, /Here is your week/);
  assert.doesNotMatch(out, /Weekly km/);
  assert.match(out, /Relative Effort/);
  assert.equal(extractChatChartsFromText(out).length, 1);
  assert.equal(extractChatChartsFromText(out)[0].type, "combo");
  assert.equal(extractChatChartsFromText(out)[0].series.length, 2);
});

test("Strava weekly chart stacks sports by time + Relative Effort line", () => {
  const charts = chartsFromStravaSummary({
    byWeek: [
      {
        weekStart: "2026-11-03",
        distance_m: 12000,
        moving_time_s: 7200,
        suffer_score: 40,
        bySport: [
          { sport: "Run", moving_time_s: 3600, distance_m: 10000, count: 2, suffer_score: 25 },
          { sport: "HIIT", moving_time_s: 2400, distance_m: 0, count: 2, suffer_score: 15 },
          { sport: "Ride", moving_time_s: 1200, distance_m: 2000, count: 1 },
        ],
      },
      {
        weekStart: "2026-11-10",
        distance_m: 18000,
        moving_time_s: 9000,
        suffer_score: 62,
        bySport: [
          { sport: "Run", moving_time_s: 5400, distance_m: 15000, count: 3, suffer_score: 40 },
          { sport: "HIIT", moving_time_s: 1800, distance_m: 0, count: 1, suffer_score: 12 },
          { sport: "Ride", moving_time_s: 1800, distance_m: 3000, count: 1, suffer_score: 10 },
        ],
      },
    ],
    bySport: [
      { sport: "Run", distance_m: 25000, moving_time_s: 9000, count: 5, suffer_score: 65 },
      { sport: "HIIT", distance_m: 0, moving_time_s: 4200, count: 3, suffer_score: 27 },
      { sport: "Ride", distance_m: 5000, moving_time_s: 3000, count: 2, suffer_score: 10 },
    ],
  });
  assert.equal(charts.length, 2);
  const weekly = charts[0];
  assert.equal(weekly.type, "combo");
  assert.equal(weekly.stack, true);
  assert.match(weekly.title || "", /time by sport/);
  assert.match(weekly.leftAxisLabel || "", /Moving time/);
  assert.match(weekly.rightAxisLabel || "", /Relative Effort/);
  // Sport bars + RE line
  assert.ok(weekly.series.length >= 3);
  assert.ok(weekly.series.every((s) => s.unit === "h" || s.unit === "RE"));
  assert.equal(weekly.series[weekly.series.length - 1].unit, "RE");
  assert.ok(weekly.series.some((s) => s.name === "HIIT"));

  const mix = charts[1];
  assert.match(mix.title || "", /time vs Relative Effort/);
  assert.equal(mix.series[0].unit, "h");
  assert.deepEqual(
    mix.series[0].data.map((d) => d.label),
    ["Run", "HIIT", "Ride"],
  );
});

test("Strava monthly chart stacks sports when period=month", () => {
  const charts = chartsFromStravaSummary(
    {
      byWeek: [
        {
          weekStart: "2026-10-27",
          distance_m: 1000,
          moving_time_s: 1000,
          bySport: [{ sport: "Run", moving_time_s: 1000, count: 1 }],
        },
      ],
      byMonth: [
        {
          monthStart: "2026-10",
          distance_m: 20000,
          moving_time_s: 20000,
          suffer_score: 80,
          bySport: [
            { sport: "Ride", moving_time_s: 12000, count: 3, suffer_score: 40 },
            { sport: "HIIT", moving_time_s: 5000, count: 4, suffer_score: 25 },
            { sport: "Run", moving_time_s: 3000, count: 2, suffer_score: 15 },
          ],
        },
        {
          monthStart: "2026-11",
          distance_m: 8000,
          moving_time_s: 15000,
          suffer_score: 55,
          bySport: [
            { sport: "HIIT", moving_time_s: 8000, count: 5, suffer_score: 35 },
            { sport: "Run", moving_time_s: 7000, count: 3, suffer_score: 20 },
          ],
        },
      ],
      bySport: [
        { sport: "HIIT", distance_m: 0, moving_time_s: 13000, count: 9, suffer_score: 60 },
        { sport: "Ride", distance_m: 20000, moving_time_s: 12000, count: 3, suffer_score: 40 },
        { sport: "Run", distance_m: 8000, moving_time_s: 10000, count: 5, suffer_score: 35 },
      ],
    },
    { period: "month" },
  );
  assert.match(charts[0].title || "", /Monthly/);
  assert.equal(charts[0].xAxisLabel, "Month");
  assert.equal(charts[0].stack, true);
  assert.ok(charts[0].series.some((s) => s.name === "HIIT"));
  assert.deepEqual(
    charts[0].series[0].data.map((d) => d.label),
    ["Oct 2026", "Nov 2026"],
  );
  // Default remains weekly when period omitted.
  const weekly = chartsFromStravaSummary({
    byWeek: [
      {
        weekStart: "2026-11-03",
        distance_m: 1000,
        moving_time_s: 3600,
        bySport: [
          { sport: "Run", moving_time_s: 2000, count: 1 },
          { sport: "HIIT", moving_time_s: 1600, count: 1 },
        ],
      },
    ],
  });
  assert.match(weekly[0].title || "", /Weekly/);
  assert.equal(weekly[0].xAxisLabel, "Week starting");
});

test("Strava weekly chart uses time without suffer_score", () => {
  const charts = chartsFromStravaSummary({
    byWeek: [
      {
        weekStart: "2026-11-03",
        distance_m: 0,
        moving_time_s: 3600,
        bySport: [
          { sport: "HIIT", moving_time_s: 2400, distance_m: 0, count: 2 },
          { sport: "Yoga", moving_time_s: 1200, distance_m: 0, count: 1 },
        ],
      },
      {
        weekStart: "2026-11-10",
        distance_m: 5000,
        moving_time_s: 4800,
        bySport: [
          { sport: "HIIT", moving_time_s: 1800, distance_m: 0, count: 1 },
          { sport: "Run", moving_time_s: 3000, distance_m: 5000, count: 2 },
        ],
      },
    ],
    bySport: [
      { sport: "HIIT", distance_m: 0, moving_time_s: 4200, count: 3 },
      { sport: "Run", distance_m: 5000, moving_time_s: 3000, count: 2 },
      { sport: "Yoga", distance_m: 0, moving_time_s: 1200, count: 1 },
    ],
  });
  assert.equal(charts[0].stack, true);
  assert.match(charts[0].leftAxisLabel || "", /Moving time/);
  assert.equal(charts[0].series.every((s) => s.unit === "h"), true);
  assert.equal(charts[1].series[0].unit, "h");
  assert.ok(charts[1].series[0].data.some((d) => d.label === "HIIT"));
});

test("PNG with bundled fonts still has text when system fonts are off", async () => {
  const { execFileSync } = await import("node:child_process");
  const script = `
    import { writeFileSync } from "node:fs";
    import { chartsFromStravaSummary } from "./src/lib/chat-chart.ts";
    import { renderChatChartSvg } from "./src/lib/chat-chart-svg.ts";
    import { Resvg } from "@resvg/resvg-js";
    const c = chartsFromStravaSummary({
      byWeek: [
        { weekStart: "2026-11-03", distance_m: 12000, moving_time_s: 3600, suffer_score: 40 },
        { weekStart: "2026-11-10", distance_m: 18000, moving_time_s: 5400, suffer_score: 62 },
      ],
    })[0];
    const svg = renderChatChartSvg(c, { theme: "light" });
    const blank = new Resvg(svg, { fitTo: { mode: "width", value: 320 }, font: { loadSystemFonts: false } });
    const blankPng = Buffer.from(blank.render().asPng());
    const ok = new Resvg(svg, {
      fitTo: { mode: "width", value: 320 },
      font: {
        loadSystemFonts: false,
        fontFiles: ["public/fonts/DejaVuSans.ttf", "public/fonts/DejaVuSans-Bold.ttf"],
        defaultFontFamily: "DejaVu Sans",
      },
    });
    const okPng = Buffer.from(ok.render().asPng());
    // Bundled fonts must change the PNG (text glyphs add opaque pixels).
    if (blankPng.equals(okPng)) throw new Error("bundled fonts did not change PNG output");
    if (okPng.byteLength <= blankPng.byteLength) throw new Error("expected larger PNG with text");
    writeFileSync("/tmp/chart-font-ok.png", okPng);
    console.log("ok", blankPng.byteLength, okPng.byteLength);
  `;
  const out = execFileSync("npx", ["--yes", "tsx", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.match(out, /ok /);
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
    if (!svg.includes('font-weight="700"')) throw new Error("axis titles should be bold");
    if (!/style="fill:/.test(svg)) throw new Error("text fill must be inline style (CSS-safe)");
    if (!/<rect /.test(svg)) throw new Error("missing bars");
    if (!/<path d="M/.test(svg)) throw new Error("missing line path");
    if (!/<circle /.test(svg)) throw new Error("missing markers");
    console.log("ok");
  `;
  const out = execFileSync("npx", ["--yes", "tsx", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.match(out, /ok/);
});
