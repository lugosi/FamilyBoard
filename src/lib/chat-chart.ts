/** Shared chart JSON for AI chat (```chart fences). Keep this file free of React. */

export type ChatChartPoint = {
  label: string;
  value: number;
};

export type ChatChartSeries = {
  name?: string;
  color?: string;
  /** Per-series unit — when it differs across series, charts use a dual axis. */
  unit?: string;
  data: ChatChartPoint[];
};

export type ChatChartSpec = {
  /**
   * `combo` = bars + a line (preferred for comparing metrics).
   * `bar` / `line` are single-style fallbacks.
   */
  type: "bar" | "line" | "combo";
  title?: string;
  /** Default unit when series omit their own. */
  unit?: string;
  /** Left Y-axis legend (e.g. "Moving time (h)"). */
  leftAxisLabel?: string;
  /** Right Y-axis legend for combo charts (e.g. "Relative Effort"). */
  rightAxisLabel?: string;
  /** Bottom X-axis legend (e.g. "Week" / "Sport"). */
  xAxisLabel?: string;
  /**
   * Stack bar series that share the left-axis unit (e.g. sports by week).
   * A series with a different unit still draws as the right-axis line.
   */
  stack?: boolean;
  /** @deprecated Prefer leftAxisLabel. */
  yLabel?: string;
  series: ChatChartSeries[];
};

const MAX_POINTS = 24;
const MAX_SERIES = 8;

export const DEFAULT_CHART_COLORS = [
  "#38bdf8",
  "#34d399",
  "#a78bfa",
  "#fb7185",
  "#fbbf24",
  "#2dd4bf",
  "#f472b6",
  "#94a3b8",
];

const DEFAULT_COLORS = DEFAULT_CHART_COLORS;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function normalizePoint(raw: unknown): ChatChartPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label =
    typeof o.label === "string"
      ? o.label.trim()
      : typeof o.x === "string"
        ? o.x.trim()
        : typeof o.name === "string"
          ? o.name.trim()
          : "";
  const value = asFiniteNumber(o.value ?? o.y);
  if (!label || value == null) return null;
  return { label: label.slice(0, 40), value };
}

function normalizeSeries(raw: unknown, index: number): ChatChartSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.data) ? o.data : Array.isArray(o.points) ? o.points : null;
  if (!list) return null;
  const data = list
    .map(normalizePoint)
    .filter((p): p is ChatChartPoint => Boolean(p))
    .slice(0, MAX_POINTS);
  if (!data.length) return null;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : undefined;
  const unit = typeof o.unit === "string" ? o.unit.trim().slice(0, 16) : undefined;
  const color =
    typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color.trim())
      ? o.color.trim()
      : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  return { name, color, unit, data };
}

/**
 * Parse a ```chart JSON body into a safe chart spec.
 * Accepts either `{ type, data: [...] }` or `{ type, series: [...] }`.
 */
export function parseChatChart(raw: string): ChatChartSpec | null {
  const trimmed = raw.trim().replace(/^```(?:chart)?\s*/i, "").replace(/```$/, "").trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const type =
    o.type === "line" ? "line" : o.type === "combo" ? "combo" : o.type === "bar" ? "bar" : null;
  if (!type) return null;

  let series: ChatChartSeries[] = [];
  if (Array.isArray(o.series)) {
    series = o.series
      .slice(0, MAX_SERIES)
      .map((s, i) => normalizeSeries(s, i))
      .filter((s): s is ChatChartSeries => Boolean(s));
  } else if (Array.isArray(o.data)) {
    const data = o.data
      .map(normalizePoint)
      .filter((p): p is ChatChartPoint => Boolean(p))
      .slice(0, MAX_POINTS);
    if (data.length) {
      series = [
        {
          name: typeof o.name === "string" ? o.name.trim().slice(0, 40) : undefined,
          color: DEFAULT_COLORS[0],
          data,
        },
      ];
    }
  }
  if (!series.length) return null;

  // Prefer combo whenever two series are present (bar + line on one chart).
  const resolvedType =
    series.length >= 2 && type !== "line" ? "combo" : type === "combo" && series.length < 2 ? "bar" : type;

  const fallbackUnit = typeof o.unit === "string" ? o.unit.trim().slice(0, 16) : undefined;
  const explicitLeft =
    typeof o.leftAxisLabel === "string"
      ? o.leftAxisLabel.trim().slice(0, 40)
      : typeof o.yLabel === "string"
        ? o.yLabel.trim().slice(0, 40)
        : undefined;
  const explicitRight =
    typeof o.rightAxisLabel === "string" ? o.rightAxisLabel.trim().slice(0, 40) : undefined;

  const seriesAxisLabel = (s: ChatChartSeries | undefined): string | undefined => {
    if (!s) return undefined;
    const unit = s.unit || fallbackUnit;
    if (s.name && unit) return `${s.name} (${unit})`.slice(0, 40);
    return (s.name || unit || undefined)?.slice(0, 40);
  };

  return {
    type: resolvedType,
    title: typeof o.title === "string" ? o.title.trim().slice(0, 80) : undefined,
    unit: fallbackUnit,
    leftAxisLabel: explicitLeft || seriesAxisLabel(series[0]),
    rightAxisLabel:
      resolvedType === "combo"
        ? explicitRight || seriesAxisLabel(series[1])
        : explicitRight,
    xAxisLabel: typeof o.xAxisLabel === "string" ? o.xAxisLabel.trim().slice(0, 40) : undefined,
    stack: o.stack === true,
    yLabel: typeof o.yLabel === "string" ? o.yLabel.trim().slice(0, 40) : undefined,
    series,
  };
}

/**
 * Remove ```chart fences from Slack text (images are uploaded separately).
 * Falls back to a one-line caption if PNG upload is unavailable.
 */
export function stripChatChartFences(text: string, mode: "remove" | "caption" = "remove"): string {
  return text
    .replace(/```chart\s*([\s\S]*?)```/gi, (_full, body: string) => {
      if (mode === "remove") return "";
      const spec = parseChatChart(String(body));
      if (!spec) return "";
      const title = spec.title || "Chart";
      const names = spec.series.map((s) => s.name).filter(Boolean).join(" vs ");
      return names ? `_Chart: ${title} (${names})_` : `_Chart: ${title}_`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract chart specs embedded as ```chart fences in a reply. */
export function extractChatChartsFromText(text: string): ChatChartSpec[] {
  const out: ChatChartSpec[] = [];
  const re = /```chart\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = parseChatChart(m[1] ?? "");
    if (spec) out.push(spec);
  }
  return out;
}

export function formatChartValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const rounded =
    abs >= 100 ? Math.round(value).toString() : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
  const cleaned = rounded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return unit ? `${cleaned} ${unit}` : cleaned;
}

export function chatChartColors(): readonly string[] {
  return DEFAULT_COLORS;
}

/** Serialize chart specs as markdown fences the Board ChatMarkdown renderer understands. */
export function chatChartFences(charts: ChatChartSpec[]): string {
  return charts
    .map((spec) => `\`\`\`chart\n${JSON.stringify(spec, null, 2)}\n\`\`\``)
    .join("\n\n");
}

/**
 * Attach tool charts as ```chart fences (same for AI tab and Slack).
 * Tool charts win: any model-authored ```chart fences are stripped and replaced
 * so we always get combo bar+line specs with axis titles.
 */
export function injectChatCharts(reply: string, charts: ChatChartSpec[]): string {
  if (!charts.length) return reply;
  const base = stripChatChartFences(reply, "remove").trim();
  const fences = chatChartFences(charts);
  return base ? `${base}\n\n${fences}` : fences;
}

export type StravaChartPeriod = "week" | "month";

type PeriodSportSlice = {
  sport: string;
  moving_time_s?: number;
  distance_m?: number;
  count?: number;
  suffer_score?: number;
};

type PeriodBucket = {
  key: string;
  label: string;
  moving_time_s?: number;
  suffer_score?: number;
  bySport?: PeriodSportSlice[];
};

function monthChartLabel(monthStart: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStart);
  if (!m) return monthStart;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m[2]) - 1;
  return `${months[idx] ?? m[2]} ${m[1]}`;
}

function periodsFromSummary(
  summary: {
    byWeek?: Array<{
      weekStart: string;
      moving_time_s?: number;
      suffer_score?: number;
      bySport?: PeriodSportSlice[];
    }>;
    byMonth?: Array<{
      monthStart: string;
      moving_time_s?: number;
      suffer_score?: number;
      bySport?: PeriodSportSlice[];
    }>;
  },
  period: StravaChartPeriod,
): PeriodBucket[] {
  if (period === "month") {
    return [...(summary.byMonth ?? [])]
      .sort((a, b) => a.monthStart.localeCompare(b.monthStart))
      .map((m) => ({
        key: m.monthStart,
        label: monthChartLabel(m.monthStart),
        moving_time_s: m.moving_time_s,
        suffer_score: m.suffer_score,
        bySport: m.bySport,
      }));
  }
  return [...(summary.byWeek ?? [])]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((w) => ({
      key: w.weekStart,
      label: w.weekStart.slice(5) || w.weekStart,
      moving_time_s: w.moving_time_s,
      suffer_score: w.suffer_score,
      bySport: w.bySport,
    }));
}

export function chartsFromStravaSummary(
  summary: {
    byWeek?: Array<{
      weekStart: string;
      distance_m: number;
      moving_time_s?: number;
      elevation_m?: number;
      /** Relative Effort proxy (Strava suffer_score). */
      suffer_score?: number;
      count?: number;
      bySport?: PeriodSportSlice[];
    }>;
    byMonth?: Array<{
      monthStart: string;
      distance_m?: number;
      moving_time_s?: number;
      elevation_m?: number;
      suffer_score?: number;
      count?: number;
      bySport?: PeriodSportSlice[];
    }>;
    bySport?: Array<{
      sport: string;
      distance_m: number;
      count?: number;
      moving_time_s?: number;
      suffer_score?: number;
    }>;
  },
  opts: { unit?: "km" | "mi"; period?: StravaChartPeriod } = {},
): ChatChartSpec[] {
  const period: StravaChartPeriod = opts.period === "month" ? "month" : "week";
  const toHours = (s: number) => Math.round(((s || 0) / 3600) * 100) / 100;
  const out: ChatChartSpec[] = [];
  const buckets = periodsFromSummary(summary, period);
  const hasLoad = buckets.some((b) => (b.suffer_score ?? 0) > 0);
  const periodWord = period === "month" ? "Monthly" : "Weekly";
  const xAxisLabel = period === "month" ? "Month" : "Week starting";

  if (buckets.length > 0) {
    // Rank sports by total moving time across the window; keep top N for stacks.
    const sportTotals = new Map<string, number>();
    for (const b of buckets) {
      for (const s of b.bySport ?? []) {
        sportTotals.set(s.sport, (sportTotals.get(s.sport) || 0) + (s.moving_time_s || 0));
      }
    }
    const rankedSports = [...sportTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, Math.max(1, MAX_SERIES - (hasLoad ? 1 : 0)));
    const hasSportSlices = rankedSports.length > 0;

    const series: ChatChartSeries[] = hasSportSlices
      ? rankedSports.map((sport, i) => ({
          name: sport.slice(0, 16),
          unit: "h",
          color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          data: buckets.map((b) => {
            const slice = (b.bySport ?? []).find((s) => s.sport === sport);
            return {
              label: b.label,
              value: toHours(slice?.moving_time_s || 0),
            };
          }),
        }))
      : [
          {
            name: "Moving time",
            unit: "h",
            color: DEFAULT_COLORS[0],
            data: buckets.map((b) => ({
              label: b.label,
              value: toHours(b.moving_time_s || 0),
            })),
          },
        ];

    if (hasLoad) {
      series.push({
        name: "Relative Effort",
        unit: "RE",
        color: "#f59e0b",
        data: buckets.map((b) => ({
          label: b.label,
          value: Math.round((b.suffer_score || 0) * 10) / 10,
        })),
      });
    }

    out.push({
      type: "combo",
      title: hasLoad
        ? `${periodWord} time by sport vs Relative Effort`
        : `${periodWord} time by sport`,
      leftAxisLabel: "Moving time (h)",
      rightAxisLabel: hasLoad ? "Relative Effort" : undefined,
      xAxisLabel,
      stack: hasSportSlices && rankedSports.length > 1,
      series,
    });
  }

  // One period chart only — sport mix is redundant with the stacked-by-sport bars.
  return out;
}
