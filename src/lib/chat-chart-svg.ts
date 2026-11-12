/**
 * Pure SVG renderer for chat charts (AI tab + Slack PNG).
 * Combo charts: first series = bars (left axis), second = line (right axis).
 *
 * Text uses inline `style="fill:…"` (not only presentation attributes) so parent
 * chat CSS like `text-slate-50` cannot turn labels white-on-white / white-on-light.
 */
import {
  formatChartValue,
  type ChatChartPoint,
  type ChatChartSeries,
  type ChatChartSpec,
} from "./chat-chart";

export type ChartTheme = "dark" | "light";

const VB_W = 720;
const VB_H = 400;
/** Room for title + series legend + axis titles + tick labels. */
const PAD = { top: 78, right: 92, bottom: 72, left: 92 };

type ThemeColors = {
  bg: string;
  grid: string;
  axis: string;
  /** High-contrast axis *title* color (stronger than tick labels). */
  axisTitle: string;
  title: string;
  muted: string;
  /** Halo behind text so it stays readable on any bg. */
  textHalo: string;
};

const THEMES: Record<ChartTheme, ThemeColors> = {
  dark: {
    bg: "#0f172a",
    grid: "#334155",
    axis: "#e2e8f0",
    axisTitle: "#f8fafc",
    title: "#ffffff",
    muted: "#cbd5e1",
    textHalo: "#0f172a",
  },
  light: {
    bg: "#ffffff",
    grid: "#cbd5e1",
    axis: "#1e293b",
    axisTitle: "#0f172a",
    title: "#020617",
    muted: "#334155",
    textHalo: "#ffffff",
  },
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text locked against CSS color inheritance from the chat surface. */
function svgText(opts: {
  x: number | string;
  y: number | string;
  fill: string;
  halo: string;
  size: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  transform?: string;
  content: string;
}): string {
  const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
  const transform = opts.transform ? ` transform="${opts.transform}"` : "";
  const weight = opts.weight ?? 500;
  // style= beats presentation attrs; paint-order halo keeps contrast on any bg.
  return `<text x="${opts.x}" y="${opts.y}"${anchor}${transform} fill="${opts.fill}" stroke="${opts.halo}" stroke-width="3.5" paint-order="stroke fill" style="fill:${opts.fill};stroke:${opts.halo}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="${opts.size}" font-weight="${weight}">${escapeXml(opts.content)}</text>`;
}

function niceDomain(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 1 };
  const dataMin = Math.min(0, ...values);
  let max = Math.max(...values);
  if (max === dataMin) max = dataMin + 1;
  const span = max - dataMin;
  const pad = span * 0.08;
  return { min: dataMin < 0 ? dataMin - pad : 0, max: max + pad };
}

function ticks(min: number, max: number, count = 4): number[] {
  if (count < 2) return [min, max];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

function allLabels(spec: ChatChartSpec): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of spec.series) {
    for (const p of s.data) {
      if (!seen.has(p.label)) {
        seen.add(p.label);
        out.push(p.label);
      }
    }
  }
  return out;
}

function valueFor(seriesData: ChatChartPoint[], label: string): number | null {
  const hit = seriesData.find((p) => p.label === label);
  return hit ? hit.value : null;
}

function seriesUnit(series: ChatChartSeries, fallback?: string): string | undefined {
  return series.unit || fallback;
}

function axisLegend(
  series: ChatChartSeries | undefined,
  fallbackUnit?: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  if (!series) return fallbackUnit || "";
  const unit = seriesUnit(series, fallbackUnit);
  if (series.name && unit) return `${series.name} (${unit})`;
  return series.name || unit || "";
}

/**
 * Split series into left-axis bars and optional right-axis line.
 * When `stack` is set, every series sharing the first series' unit stacks;
 * a series with a different unit becomes the dual-axis line.
 */
function splitSeries(spec: ChatChartSpec): {
  barSeries: ChatChartSeries[];
  lineSeries: ChatChartSeries[];
  dual: boolean;
  stack: boolean;
} {
  if (spec.series.length < 2) {
    return {
      barSeries: spec.type === "line" ? [] : spec.series,
      lineSeries: spec.type === "line" ? spec.series : [],
      dual: false,
      stack: false,
    };
  }
  const leftUnit = seriesUnit(spec.series[0], spec.unit) || "";
  if (spec.stack) {
    const barSeries = spec.series.filter(
      (s) => (seriesUnit(s, spec.unit) || leftUnit) === leftUnit,
    );
    const lineSeries = spec.series
      .filter((s) => (seriesUnit(s, spec.unit) || "") !== leftUnit)
      .slice(0, 1);
    return {
      barSeries: barSeries.length ? barSeries : [spec.series[0]],
      lineSeries,
      dual: lineSeries.length > 0,
      stack: barSeries.length > 1,
    };
  }
  // Classic combo: first = bars, second = line.
  return {
    barSeries: [spec.series[0]],
    lineSeries: [spec.series[1]],
    dual: true,
    stack: false,
  };
}

/** Render a chart to an SVG string (embeddable / PNG via resvg). */
export function renderChatChartSvg(
  spec: ChatChartSpec,
  opts: { theme?: ChartTheme } = {},
): string {
  const theme = THEMES[opts.theme ?? "dark"];
  const labels = allLabels(spec);
  const { barSeries, lineSeries, dual, stack } = splitSeries(spec);

  const stackTotals = labels.map((label) =>
    barSeries.reduce((sum, s) => sum + (valueFor(s.data, label) ?? 0), 0),
  );
  const leftValues = stack
    ? stackTotals
    : barSeries.flatMap((s) => s.data.map((d) => d.value));
  const rightValues = lineSeries.flatMap((s) => s.data.map((d) => d.value));
  const leftDom = niceDomain(leftValues.length ? leftValues : [0, 1]);
  const rightDom = niceDomain(rightValues.length ? rightValues : [0, 1]);
  const leftTicks = ticks(leftDom.min, leftDom.max);
  const rightTicks = ticks(rightDom.min, rightDom.max);

  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const n = Math.max(labels.length, 1);
  const band = plotW / n;

  const yLeft = (v: number) =>
    PAD.top + plotH - ((v - leftDom.min) / Math.max(leftDom.max - leftDom.min, 1e-6)) * plotH;
  const yRight = (v: number) =>
    PAD.top + plotH - ((v - rightDom.min) / Math.max(rightDom.max - rightDom.min, 1e-6)) * plotH;

  const leftLabel =
    spec.leftAxisLabel?.trim() ||
    (stack
      ? `Moving time (${seriesUnit(barSeries[0], spec.unit) || "h"})`
      : axisLegend(barSeries[0], spec.unit, spec.yLabel));
  const rightLabel = dual
    ? axisLegend(lineSeries[0], spec.unit, spec.rightAxisLabel)
    : "";
  const xLabel =
    spec.xAxisLabel?.trim() ||
    (labels.length ? "Category" : "");

  const lineSet = new Set(lineSeries);
  const parts: string[] = [];
  // color on root helps if any child falls back to currentColor.
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}" style="color:${theme.axisTitle};background:${theme.bg}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${theme.bg}" style="fill:${theme.bg}" rx="12"/>`);

  if (spec.title) {
    parts.push(
      svgText({
        x: PAD.left,
        y: 22,
        fill: theme.title,
        halo: theme.textHalo,
        size: 16,
        weight: 700,
        content: spec.title,
      }),
    );
  }

  // Series legend under the title (never overlaps axis titles).
  const legendY = 42;
  let lx = PAD.left;
  spec.series.forEach((s, i) => {
    const name = s.name || `Series ${i + 1}`;
    const unit = seriesUnit(s, spec.unit);
    const text = unit ? `${name} (${unit})` : name;
    const isLine = lineSet.has(s) || (spec.type === "line" && !barSeries.length);
    if (isLine) {
      parts.push(
        `<line x1="${lx}" x2="${lx + 18}" y1="${legendY - 4}" y2="${legendY - 4}" stroke="${s.color ?? "#fbbf24"}" stroke-width="3.5"/>`,
      );
      parts.push(
        `<circle cx="${lx + 9}" cy="${legendY - 4}" r="3.5" fill="${s.color ?? "#fbbf24"}" style="fill:${s.color ?? "#fbbf24"}"/>`,
      );
    } else {
      parts.push(
        `<rect x="${lx}" y="${legendY - 10}" width="12" height="10" rx="2" fill="${s.color ?? "#38bdf8"}" style="fill:${s.color ?? "#38bdf8"}"/>`,
      );
    }
    parts.push(
      svgText({
        x: lx + 20,
        y: legendY,
        fill: theme.muted,
        halo: theme.textHalo,
        size: 11,
        content: text,
      }),
    );
    lx += 20 + text.length * 6.6 + 16;
  });

  // Axis titles: horizontal caps above each Y scale + rotated titles along the spines.
  if (leftLabel) {
    parts.push(
      svgText({
        x: PAD.left,
        y: PAD.top - 12,
        fill: theme.axisTitle,
        halo: theme.textHalo,
        size: 13,
        weight: 700,
        anchor: "start",
        content: leftLabel,
      }),
    );
    const cx = 18;
    const cy = PAD.top + plotH / 2;
    parts.push(
      svgText({
        x: cx,
        y: cy,
        fill: theme.axisTitle,
        halo: theme.textHalo,
        size: 12,
        weight: 700,
        anchor: "middle",
        transform: `rotate(-90 ${cx} ${cy})`,
        content: leftLabel,
      }),
    );
  }
  if (rightLabel) {
    parts.push(
      svgText({
        x: VB_W - PAD.right,
        y: PAD.top - 12,
        fill: theme.axisTitle,
        halo: theme.textHalo,
        size: 13,
        weight: 700,
        anchor: "end",
        content: rightLabel,
      }),
    );
    const cx = VB_W - 18;
    const cy = PAD.top + plotH / 2;
    parts.push(
      svgText({
        x: cx,
        y: cy,
        fill: theme.axisTitle,
        halo: theme.textHalo,
        size: 12,
        weight: 700,
        anchor: "middle",
        transform: `rotate(90 ${cx} ${cy})`,
        content: rightLabel,
      }),
    );
  }

  // Grid + left tick labels.
  for (const t of leftTicks) {
    const y = yLeft(t);
    parts.push(
      `<line x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${y}" y2="${y}" stroke="${theme.grid}" stroke-width="1"/>`,
    );
    parts.push(
      svgText({
        x: PAD.left - 8,
        y: y + 4,
        fill: theme.axis,
        halo: theme.textHalo,
        size: 11,
        anchor: "end",
        content: formatChartValue(t),
      }),
    );
  }

  if (dual && lineSeries.length) {
    for (const t of rightTicks) {
      const y = yRight(t);
      parts.push(
        svgText({
          x: VB_W - PAD.right + 8,
          y: y + 4,
          fill: theme.axis,
          halo: theme.textHalo,
          size: 11,
          anchor: "start",
          content: formatChartValue(t),
        }),
      );
    }
  }

  // Left / right axis spines so the titles clearly belong to an axis.
  parts.push(
    `<line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${PAD.top + plotH}" stroke="${theme.axis}" stroke-width="1.5" opacity="0.7"/>`,
  );
  if (dual) {
    parts.push(
      `<line x1="${VB_W - PAD.right}" x2="${VB_W - PAD.right}" y1="${PAD.top}" y2="${PAD.top + plotH}" stroke="${theme.axis}" stroke-width="1.5" opacity="0.7"/>`,
    );
  }
  parts.push(
    `<line x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${PAD.top + plotH}" y2="${PAD.top + plotH}" stroke="${theme.axis}" stroke-width="1.5" opacity="0.7"/>`,
  );

  const drawBars = (
    seriesList: ChatChartSeries[],
    yScale: (v: number) => number,
    stacked: boolean,
  ) => {
    const barW = Math.max(12, band * 0.55);
    if (stacked && seriesList.length > 1) {
      labels.forEach((label, li) => {
        let cumulative = 0;
        const x = PAD.left + li * band + (band - barW) / 2;
        seriesList.forEach((series, si) => {
          const v = valueFor(series.data, label) ?? 0;
          if (v <= 0) return;
          const y0 = yScale(cumulative);
          const y1 = yScale(cumulative + v);
          cumulative += v;
          const top = Math.min(y0, y1);
          const h = Math.max(1.5, Math.abs(y0 - y1));
          const color = series.color ?? "#38bdf8";
          // Round only the top segment of the stack.
          const rx = si === seriesList.length - 1 || cumulative === stackTotals[li] ? 3 : 0;
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" fill="${color}" style="fill:${color}" opacity="0.92"/>`,
          );
        });
      });
      return;
    }
    const seriesCount = Math.max(seriesList.length, 1);
    seriesList.forEach((series, si) => {
      const w = Math.max(10, (band * 0.5) / seriesCount);
      for (const p of series.data) {
        const li = labels.indexOf(p.label);
        if (li < 0) continue;
        const x = PAD.left + li * band + (band - w * seriesCount) / 2 + si * w;
        const y0 = yScale(0);
        const y1 = yScale(p.value);
        const top = Math.min(y0, y1);
        const h = Math.max(2, Math.abs(y0 - y1));
        const color = series.color ?? "#38bdf8";
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" style="fill:${color}" opacity="0.92"/>`,
        );
      }
    });
  };

  const drawLines = (seriesList: ChatChartSeries[], yScale: (v: number) => number) => {
    seriesList.forEach((series) => {
      const color = series.color ?? "#f59e0b";
      const pts = labels
        .map((label, i) => {
          const v = valueFor(series.data, label);
          if (v == null) return null;
          return {
            x: PAD.left + i * band + band / 2,
            y: yScale(v),
          };
        })
        .filter((p): p is { x: number; y: number } => Boolean(p));
      if (!pts.length) return;
      if (pts.length >= 2) {
        const baseY = PAD.top + plotH;
        const area = [
          `M${pts[0].x.toFixed(1)},${baseY.toFixed(1)}`,
          ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
          `L${pts[pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)}`,
          "Z",
        ].join(" ");
        parts.push(`<path d="${area}" fill="${color}" style="fill:${color}" opacity="0.14"/>`);
      }
      const d = pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      for (const p of pts) {
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" style="fill:${color}" stroke="${theme.bg}" stroke-width="2"/>`,
        );
      }
    });
  };

  if (barSeries.length) drawBars(barSeries, yLeft, stack);
  if (lineSeries.length) drawLines(lineSeries, dual ? yRight : yLeft);

  labels.forEach((label, i) => {
    const x = PAD.left + i * band + band / 2;
    const short = label.length > 10 && labels.length > 5 ? `${label.slice(0, 8)}…` : label;
    parts.push(
      svgText({
        x,
        y: VB_H - (xLabel ? 38 : 24),
        fill: theme.muted,
        halo: theme.textHalo,
        size: 11,
        anchor: "middle",
        content: short,
      }),
    );
  });

  if (xLabel) {
    parts.push(
      svgText({
        x: PAD.left + plotW / 2,
        y: VB_H - 14,
        fill: theme.axisTitle,
        halo: theme.textHalo,
        size: 13,
        weight: 700,
        anchor: "middle",
        content: xLabel,
      }),
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
