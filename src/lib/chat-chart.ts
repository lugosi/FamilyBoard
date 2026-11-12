/** Shared chart JSON for AI chat (```chart fences). Keep this file free of React. */

export type ChatChartPoint = {
  label: string;
  value: number;
};

export type ChatChartSeries = {
  name?: string;
  color?: string;
  data: ChatChartPoint[];
};

export type ChatChartSpec = {
  type: "bar" | "line";
  title?: string;
  unit?: string;
  /** Optional y-axis hint shown in the corner. */
  yLabel?: string;
  series: ChatChartSeries[];
};

const MAX_POINTS = 24;
const MAX_SERIES = 4;

const DEFAULT_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#fb7185"];

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
  const color =
    typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color.trim())
      ? o.color.trim()
      : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  return { name, color, data };
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
  const type = o.type === "line" ? "line" : o.type === "bar" ? "bar" : null;
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

  return {
    type,
    title: typeof o.title === "string" ? o.title.trim().slice(0, 80) : undefined,
    unit: typeof o.unit === "string" ? o.unit.trim().slice(0, 16) : undefined,
    yLabel: typeof o.yLabel === "string" ? o.yLabel.trim().slice(0, 24) : undefined,
    series,
  };
}

/** Replace ```chart … ``` fences with a short Slack-safe line. */
export function stripChatChartFences(text: string): string {
  return text.replace(/```chart\s*([\s\S]*?)```/gi, (_full, body: string) => {
    const spec = parseChatChart(String(body));
    if (!spec) return "_(chart)_";
    const title = spec.title || "Chart";
    const first = spec.series[0]?.data ?? [];
    const bits = first.slice(0, 6).map((p) => `${p.label} ${formatChartValue(p.value, spec.unit)}`);
    const more = first.length > 6 ? ` …+${first.length - 6}` : "";
    return `*${title}*${bits.length ? `: ${bits.join(", ")}${more}` : ""}`;
  });
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
 * Ensure board replies include charts from tools. Skips when fences already exist
 * (model emitted them) or when there is nothing to attach.
 */
export function injectChatCharts(reply: string, charts: ChatChartSpec[]): string {
  if (!charts.length) return reply;
  if (/```chart\b/i.test(reply)) return reply;
  const fences = chatChartFences(charts);
  const base = reply.trim();
  return base ? `${base}\n\n${fences}` : fences;
}

export function chartsFromStravaSummary(
  summary: {
    byWeek?: Array<{ weekStart: string; distance_m: number; moving_time_s?: number }>;
    bySport?: Array<{ sport: string; distance_m: number; count?: number }>;
  },
  opts: { unit?: "km" | "mi" } = {},
): ChatChartSpec[] {
  const unit = opts.unit === "mi" ? "mi" : "km";
  const toDist = (m: number) =>
    unit === "mi"
      ? Math.round((m / 1609.34) * 10) / 10
      : Math.round((m / 1000) * 10) / 10;
  const out: ChatChartSpec[] = [];
  const weeks = [...(summary.byWeek ?? [])].sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
  if (weeks.length > 0) {
    out.push({
      type: "bar",
      title: `Distance by week (${unit})`,
      unit,
      series: [
        {
          name: "Distance",
          color: DEFAULT_COLORS[0],
          data: weeks.map((w) => ({
            label: w.weekStart.slice(5) || w.weekStart,
            value: toDist(w.distance_m || 0),
          })),
        },
      ],
    });
  }
  const sports = [...(summary.bySport ?? [])]
    .filter((s) => (s.distance_m || 0) > 0)
    .sort((a, b) => b.distance_m - a.distance_m)
    .slice(0, 8);
  if (sports.length > 1) {
    out.push({
      type: "bar",
      title: `Distance by sport (${unit})`,
      unit,
      series: [
        {
          name: "Distance",
          color: DEFAULT_COLORS[1],
          data: sports.map((s) => ({
            label: s.sport.slice(0, 16),
            value: toDist(s.distance_m || 0),
          })),
        },
      ],
    });
  }
  return out;
}
