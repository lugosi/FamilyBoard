"use client";

import type { ClimateHistorySample } from "@/lib/nest-climate-history";

type Props = {
  history: ClimateHistorySample[];
};

type ChartPoint = { t: number; value: number };

function formatHourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" });
}

function toPoints(
  history: ClimateHistorySample[],
  pick: (s: ClimateHistorySample) => number | null,
): ChartPoint[] {
  return history
    .map((s) => {
      const value = pick(s);
      return Number.isFinite(value) ? { t: s.t, value: value! } : null;
    })
    .filter((p): p is ChartPoint => p !== null);
}

function linePath(
  points: ChartPoint[],
  width: number,
  height: number,
  minV: number,
  maxV: number,
  tMin: number,
  tMax: number,
): string {
  if (points.length === 0) return "";
  const padX = 4;
  const padY = 6;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const tSpan = Math.max(tMax - tMin, 1);
  const vSpan = Math.max(maxV - minV, 0.1);
  return points
    .map((p, i) => {
      const x = padX + ((p.t - tMin) / tSpan) * w;
      const y = padY + h - ((p.value - minV) / vSpan) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function ClimateSparkline({
  label,
  unit,
  color,
  points,
}: {
  label: string;
  unit: string;
  color: string;
  points: ChartPoint[];
}) {
  const width = 280;
  const height = 72;
  const now = Date.now();
  const tMin = now - 12 * 60 * 60 * 1000;
  const tMax = now;

  const values = points.map((p) => p.value);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const pad = Math.max((maxV - minV) * 0.08, 0.5);
  const yMin = minV - pad;
  const yMax = maxV + pad;
  const path = linePath(points, width, height, yMin, yMax, tMin, tMax);
  const latest = points[points.length - 1];

  return (
    <div className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <span className="tabular-nums text-sm font-semibold text-slate-100">
          {latest !== undefined ? `${Math.round(latest.value * 10) / 10}${unit}` : "—"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[4.5rem] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          x1={4}
          y1={height - 6}
          x2={width - 4}
          y2={height - 6}
          stroke="currentColor"
          strokeOpacity={0.12}
          className="text-slate-400"
        />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{formatHourLabel(tMin)}</span>
        <span className="text-slate-600">12h</span>
        <span>{formatHourLabel(tMax)}</span>
      </div>
    </div>
  );
}

export function IndoorClimateCharts({ history }: Props) {
  const tempPoints = toPoints(history, (s) => s.temperatureF);
  const humPoints = toPoints(history, (s) => s.humidity);

  if (tempPoints.length < 2 && humPoints.length < 2) {
    return (
      <p className="mt-2 text-xs text-slate-500 sm:text-sm">
        12-hour charts fill in as readings are collected (about once per minute).
      </p>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <ClimateSparkline label="Temp" unit="°F" color="#f97316" points={tempPoints} />
      <ClimateSparkline label="Humidity" unit="%" color="#38bdf8" points={humPoints} />
    </div>
  );
}
