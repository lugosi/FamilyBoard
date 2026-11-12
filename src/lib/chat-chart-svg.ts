/**
 * Pure SVG renderer for chat charts (AI tab + Slack PNG).
 * Dual-axis when series use different units so metrics can be compared.
 */
import {
  formatChartValue,
  type ChatChartPoint,
  type ChatChartSeries,
  type ChatChartSpec,
} from "./chat-chart";

export type ChartTheme = "dark" | "light";

const VB_W = 640;
const VB_H = 320;
const PAD = { top: 44, right: 52, bottom: 48, left: 52 };

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
    axis: "#64748b",
    title: "#e2e8f0",
    muted: "#94a3b8",
  },
  light: {
    bg: "#ffffff",
    grid: "#e2e8f0",
    axis: "#64748b",
    title: "#0f172a",
    muted: "#475569",
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

function usesDualAxis(spec: ChatChartSpec): boolean {
  if (spec.series.length < 2) return false;
  const u0 = seriesUnit(spec.series[0], spec.unit) || "";
  const u1 = seriesUnit(spec.series[1], spec.unit) || "";
  return Boolean(u0 && u1 && u0 !== u1);
}

/** Render a chart to an SVG string (embeddable / PNG via resvg). */
export function renderChatChartSvg(
  spec: ChatChartSpec,
  opts: { theme?: ChartTheme } = {},
): string {
  const theme = THEMES[opts.theme ?? "dark"];
  const labels = allLabels(spec);
  const dual = usesDualAxis(spec);
  const leftSeries = dual ? [spec.series[0]] : spec.series;
  const rightSeries = dual ? spec.series.slice(1, 2) : [];

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

  const leftUnit = seriesUnit(leftSeries[0] ?? { data: [] }, spec.unit);
  const rightUnit = rightSeries[0]
    ? seriesUnit(rightSeries[0], spec.unit)
    : undefined;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${theme.bg}" rx="12"/>`);

  if (spec.title) {
    parts.push(
      `<text x="${PAD.left}" y="26" fill="${theme.title}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="16" font-weight="600">${escapeXml(spec.title)}</text>`,
    );
  }

  for (const t of leftTicks) {
    const y = yLeft(t);
    parts.push(
      `<line x1="${PAD.left}" x2="${VB_W - PAD.right}" y1="${y}" y2="${y}" stroke="${theme.grid}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${PAD.left - 8}" y="${y + 4}" text-anchor="end" fill="${theme.axis}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(formatChartValue(t, leftUnit))}</text>`,
    );
  }

  if (dual && rightSeries.length) {
    for (const t of rightTicks) {
      const y = yRight(t);
      parts.push(
        `<text x="${VB_W - PAD.right + 8}" y="${y + 4}" text-anchor="start" fill="${theme.axis}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(formatChartValue(t, rightUnit))}</text>`,
      );
    }
  }

  // Draw series: left as bars (or lines if type=line), right always as line when dual.
  const drawBars = (seriesList: ChatChartSeries[], yScale: (v: number) => number) => {
    const seriesCount = Math.max(seriesList.length, 1);
    seriesList.forEach((series, si) => {
      const barW = Math.max(6, (band * 0.72) / seriesCount);
      for (const p of series.data) {
        const li = labels.indexOf(p.label);
        if (li < 0) continue;
        const x = PAD.left + li * band + band * 0.14 + si * barW;
        const y0 = yScale(0);
        const y1 = yScale(p.value);
        const top = Math.min(y0, y1);
        const h = Math.max(1.5, Math.abs(y0 - y1));
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${series.color ?? "#38bdf8"}" opacity="0.92"/>`,
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
        `<path d="${d}" fill="none" stroke="${series.color ?? "#34d399"}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      for (const p of pts) {
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${series.color ?? "#34d399"}"/>`,
        );
      }
    });
  };

  if (dual) {
    // Compare metrics: bars for primary, line for secondary (different units).
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
      `<text x="${x}" y="${VB_H - 16}" text-anchor="middle" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(short)}</text>`,
    );
  });

  // Legend
  const legendItems = spec.series.filter((s) => s.name);
  if (legendItems.length) {
    let lx = PAD.left;
    const ly = VB_H - 4;
    legendItems.forEach((s, i) => {
      const unit = seriesUnit(s, spec.unit);
      const text = unit ? `${s.name} (${unit})` : s.name!;
      parts.push(
        `<rect x="${lx}" y="${ly - 18}" width="10" height="10" rx="2" fill="${s.color ?? "#38bdf8"}"/>`,
      );
      parts.push(
        `<text x="${lx + 14}" y="${ly - 9}" fill="${theme.muted}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11">${escapeXml(text)}</text>`,
      );
      lx += 14 + text.length * 6.6 + 16;
      void i;
    });
  }

  parts.push("</svg>");
  return parts.join("");
}
