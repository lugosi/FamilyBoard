"use client";

import type { ClimateHistorySample } from "@/lib/nest-climate-history";

type Props = {
  history: ClimateHistorySample[];
};

type ChartPoint = { t: number; value: number };

const PLOT_H = 88;
const YLAB_W = 38;
const PLOT_W = 220;
const TOTAL_W = YLAB_W + PLOT_W;
const PAD_TOP = 8;
const PAD_BOTTOM = 14;

function formatHourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" });
}

function formatTick(value: number, unit: string): string {
  if (unit === "%") return `${Math.round(value)}`;
  return `${Math.round(value * 10) / 10}`;
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

function scaleTicks(minV: number, maxV: number, count = 4): number[] {
  if (count < 2) return [minV, maxV];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return minV + t * (maxV - minV);
  });
}

function yForValue(value: number, yMin: number, yMax: number): number {
  const plotInner = PLOT_H - PAD_TOP - PAD_BOTTOM;
  const span = Math.max(yMax - yMin, 0.1);
  return PAD_TOP + plotInner - ((value - yMin) / span) * plotInner;
}

function linePath(
  points: ChartPoint[],
  yMin: number,
  yMax: number,
  tMin: number,
  tMax: number,
): string {
  if (points.length === 0) return "";
  const plotInnerW = PLOT_W - 8;
  const tSpan = Math.max(tMax - tMin, 1);
  return points
    .map((p, i) => {
      const x = YLAB_W + 4 + ((p.t - tMin) / tSpan) * plotInnerW;
      const y = yForValue(p.value, yMin, yMax);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function ClimateChart({
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
  const now = Date.now();
  const tMin = now - 12 * 60 * 60 * 1000;
  const tMax = now;

  const values = points.map((p) => p.value);
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 100;
  const pad = Math.max((dataMax - dataMin) * 0.06, unit === "%" ? 2 : 0.5);
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const ticks = scaleTicks(yMin, yMax);
  const scaleMin = ticks[0] ?? yMin;
  const scaleMax = ticks[ticks.length - 1] ?? yMax;
  const path = linePath(points, scaleMin, scaleMax, tMin, tMax);
  const latest = points[points.length - 1];

  return (
    <div className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {latest !== undefined ? (
          <span className="tabular-nums text-sm font-semibold" style={{ color }}>
            {formatTick(latest.value, unit)}
            {unit}
          </span>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${TOTAL_W} ${PLOT_H}`}
        className="h-[5.5rem] w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${label} over the last 12 hours`}
      >
        {ticks.map((tick) => {
          const y = yForValue(tick, scaleMin, scaleMax);
          return (
            <g key={tick}>
              <line
                x1={YLAB_W}
                y1={y}
                x2={TOTAL_W - 2}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                className="text-slate-400"
              />
              <text
                x={YLAB_W - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 text-[9px]"
              >
                {formatTick(tick, unit)}
              </text>
            </g>
          );
        })}
        <line
          x1={YLAB_W}
          y1={PLOT_H - PAD_BOTTOM}
          x2={TOTAL_W - 2}
          y2={PLOT_H - PAD_BOTTOM}
          stroke="currentColor"
          strokeOpacity={0.2}
          className="text-slate-500"
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
      <div
        className="flex justify-between pl-[2.4rem] text-[10px] text-slate-500"
        style={{ marginTop: 2 }}
      >
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
      <p className="text-xs text-slate-500 sm:text-sm">
        12-hour charts fill in as readings are collected (about once per minute).
      </p>
    );
  }

  return (
    <div className="flex gap-2">
      <ClimateChart label="Temperature" unit="°F" color="#f97316" points={tempPoints} />
      <ClimateChart label="Humidity" unit="%" color="#38bdf8" points={humPoints} />
    </div>
  );
}
