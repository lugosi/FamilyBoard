/**
 * Pure SVG renderer for chat charts (AI tab + Slack PNG).
 * Combo charts: first series = bars (left axis), second = line (right axis).
 */
import {
  formatChartValue,
  type ChatChartPoint,
  type ChatChartSeries,
  type ChatChartSpec,
} from "./chat-chart";

export type ChartTheme = "dark" | "light";

const VB_W = 680;
const VB_H = 360;
const PAD = { top: 48, right: 72, bottom: 64, left: 72 };

type ThemeColors = {
  bg: string;
  grid: string;
  axis: string;
  title: string;
  muted: string;
};

const THEMES: Record<ChartTheme, ThemeColors> = {
  dark: {
    bg: "#0f172a",
    grid: "#1e293b",
    axis: "#94a3b8",
    title: "#e2e8f0",
    muted: "#94a3b8",
  },
  light: {
    bg: "#ffffff",
    grid: "#e2e8f0",
    axis: "#475569",
    title: "#0f172a",
    muted: "#64748b",
  },
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function axisLegend(series: ChatChartSeries | undefined, fallbackUnit?: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (!series) return fallbackUnit || "";
  const unit = seriesUnit(series, fallbackUnit);
  if (series.name && unit) return `${series.name} (${unit})`;
  return series.name || unit || "";
}

/** Two+ series → combo (bar + line). */
function isCombo(spec: ChatChartSpec): boolean {
  return spec.series.length >= 2 && spec.type !== "line";
}

/** Render a chart to an SVG string (embeddable / PNG via resvg). */
export function renderChatChartSvg(
  spec: ChatChartSpec,
  opts: { theme?: ChartTheme } = {},
): string {
  const theme = THEMES[opts.theme ?? "dark"];
  const labels = allLabels(spec);
  const combo = isCombo(spec);
  const leftSeries = combo ? [spec.series[0]] : spec.series;
  const rightSeries = combo ? spec.series.slice(1, 2) : [];

  const leftValues = leftSeries.flatMap((s) => s.data.map((d) => d.value));
  const rightValues = rightSeries.flatMap((s) => s.data.map((d) => d.value));
  const leftDom = niceDomain(leftValues);
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

  const leftLabel = axisLegend(
    leftSeries[0],
    spec.unit,
    spec.leftAxisLabel || spec.yLabel,
  );
  const rightLabel = combo
    ? axisLegend(rightSeries[0], spec.unit, spec.rightAxisLabel)
    : "";
  const xLabel = spec.xAxisLabel?.trim() || "";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${theme.bg}" rx="12"/>`);

  if (spec.title) {
    parts.push(
      `<text x="${PAD.left}" y="28" fill="${theme.title}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="16" font-weight="600">${escapeXml(spec.title)}</text>`,
    );
  }

  // Grid + left tick labels (values only; axis legend is separate).
  for (const t of leftTicks) {
    const y = yLeft(t);
    parts.push(
      `<line x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${y}" y2="${y}" stroke="${theme.grid}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${PAD.left - 10}" y="${y + 4}" text-anchor="end" fill="${theme.axis}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(formatChartValue(t))}</text>`,
    );
  }

  if (combo && rightSeries.length) {
    for (const t of rightTicks) {
      const y = yRight(t);
      parts.push(
        `<text x="${VB_W - PAD.right + 10}" y="${y + 4}" text-anchor="start" fill="${theme.axis}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(formatChartValue(t))}</text>`,
      );
    }
  }

  // Axis legends (both Y axes when combo; always left).
  if (leftLabel) {
    const cx = 18;
    const cy = PAD.top + plotH / 2;
    parts.push(
      `<text x="${cx}" y="${cy}" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})">${escapeXml(leftLabel)}</text>`,
    );
  }
  if (rightLabel) {
    const cx = VB_W - 18;
    const cy = PAD.top + plotH / 2;
    parts.push(
      `<text x="${cx}" y="${cy}" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(90 ${cx} ${cy})">${escapeXml(rightLabel)}</text>`,
    );
  }

  const drawBars = (seriesList: ChatChartSeries[], yScale: (v: number) => number) => {
    const seriesCount = Math.max(seriesList.length, 1);
    seriesList.forEach((series, si) => {
      const barW = Math.max(8, (band * 0.55) / seriesCount);
      for (const p of series.data) {
        const li = labels.indexOf(p.label);
        if (li < 0) continue;
        const x = PAD.left + li * band + (band - barW * seriesCount) / 2 + si * barW;
        const y0 = yScale(0);
        const y1 = yScale(p.value);
        const top = Math.min(y0, y1);
        const h = Math.max(1.5, Math.abs(y0 - y1));
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${series.color ?? "#38bdf8"}" opacity="0.9"/>`,
        );
      }
    });
  };

  const drawLines = (seriesList: ChatChartSeries[], yScale: (v: number) => number) => {
    seriesList.forEach((series) => {
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
      const d = pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke="${series.color ?? "#fbbf24"}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      for (const p of pts) {
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${series.color ?? "#fbbf24"}" stroke="${theme.bg}" stroke-width="1.5"/>`,
        );
      }
    });
  };

  if (combo) {
    drawBars(leftSeries, yLeft);
    drawLines(rightSeries, yRight);
  } else if (spec.type === "line") {
    drawLines(spec.series, yLeft);
  } else {
    drawBars(spec.series, yLeft);
  }

  labels.forEach((label, i) => {
    const x = PAD.left + i * band + band / 2;
    const short = label.length > 10 && labels.length > 5 ? `${label.slice(0, 8)}…` : label;
    parts.push(
      `<text x="${x}" y="${VB_H - (xLabel ? 34 : 22)}" text-anchor="middle" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(short)}</text>`,
    );
  });

  if (xLabel) {
    parts.push(
      `<text x="${PAD.left + plotW / 2}" y="${VB_H - 14}" text-anchor="middle" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" font-weight="600">${escapeXml(xLabel)}</text>`,
    );
  }

  // Series legend (bar vs line glyphs).
  const legendY = 44;
  let lx = PAD.left;
  spec.series.forEach((s, i) => {
    const name = s.name || `Series ${i + 1}`;
    const unit = seriesUnit(s, spec.unit);
    const text = unit ? `${name} (${unit})` : name;
    const isLine = combo ? i > 0 : spec.type === "line";
    if (isLine) {
      parts.push(
        `<line x1="${lx}" x2="${lx + 16}" y1="${legendY - 4}" y2="${legendY - 4}" stroke="${s.color ?? "#fbbf24"}" stroke-width="3"/>`,
      );
      parts.push(
        `<circle cx="${lx + 8}" cy="${legendY - 4}" r="3.5" fill="${s.color ?? "#fbbf24"}"/>`,
      );
    } else {
      parts.push(
        `<rect x="${lx}" y="${legendY - 10}" width="12" height="10" rx="2" fill="${s.color ?? "#38bdf8"}"/>`,
      );
    }
    parts.push(
      `<text x="${lx + 18}" y="${legendY}" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(text)}</text>`,
    );
    lx += 18 + text.length * 6.5 + 18;
  });

  parts.push("</svg>");
  return parts.join("");
}
