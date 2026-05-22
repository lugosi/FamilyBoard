"use client";

import { useMemo } from "react";
import { WeatherIcon } from "@/components/WeatherIcon";
import { wmoLabel } from "@/lib/wmo";

export type WeatherHourlyPoint = {
  time: string;
  temperatureF: number;
  code: number;
};

type Props = {
  hours: WeatherHourlyPoint[];
};

const MAX_POINTS = 10;
const SLOT_W = 44;
const ICON_H = 26;
const PLOT_H = 72;
const LABEL_H = 16;
const YLAB_W = 34;
const PAD_TOP = 4;
const PAD_BOTTOM = 2;

function hourLabel(time: string): string {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return (time ?? "").slice(11, 16);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

/** From current hour onward; evenly subsample so the chart stays readable in a narrow widget. */
function hoursForDisplay(all: WeatherHourlyPoint[]): WeatherHourlyPoint[] {
  if (all.length === 0) return [];
  const now = Date.now();
  const fromNow = all.filter((h) => new Date(h.time).getTime() >= now - 45 * 60 * 1000);
  const pool = fromNow.length >= 2 ? fromNow : all;
  if (pool.length <= MAX_POINTS) return pool;
  const step = Math.ceil(pool.length / MAX_POINTS);
  const picked: WeatherHourlyPoint[] = [];
  for (let i = 0; i < pool.length; i += step) {
    picked.push(pool[i]!);
  }
  const last = pool[pool.length - 1]!;
  if (picked[picked.length - 1]?.time !== last.time) picked.push(last);
  return picked.slice(0, MAX_POINTS);
}

function yForValue(value: number, yMin: number, yMax: number): number {
  const inner = PLOT_H - PAD_TOP - PAD_BOTTOM;
  const span = Math.max(yMax - yMin, 1);
  return ICON_H + PAD_TOP + inner - ((value - yMin) / span) * inner;
}

function scaleTicks(minV: number, maxV: number, count = 3): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return minV + t * (maxV - minV);
  });
}

function shouldShowHourLabel(index: number, total: number): boolean {
  if (total <= 6) return true;
  if (index === 0 || index === total - 1) return true;
  return index % 2 === 0;
}

export function WeatherHourlyChart({ hours }: Props) {
  const displayHours = useMemo(() => hoursForDisplay(hours), [hours]);

  if (displayHours.length < 2) {
    return (
      <p className="text-xs text-slate-500 sm:text-sm">Hourly forecast not available yet.</p>
    );
  }

  const values = displayHours.map((h) => h.temperatureF);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const pad = Math.max((dataMax - dataMin) * 0.12, 2);
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const ticks = scaleTicks(yMin, yMax);
  const scaleMin = ticks[0] ?? yMin;
  const scaleMax = ticks[ticks.length - 1] ?? yMax;

  const n = displayHours.length;
  const plotW = Math.max(n * SLOT_W, SLOT_W * 2);
  const totalW = YLAB_W + plotW;
  const totalH = ICON_H + PLOT_H + LABEL_H;
  const xAt = (i: number) => YLAB_W + SLOT_W / 2 + i * SLOT_W;

  const linePath = displayHours
    .map((h, i) => {
      const x = xAt(i);
      const y = yForValue(h.temperatureF, scaleMin, scaleMax);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const baselineY = ICON_H + PLOT_H - PAD_BOTTOM;
  const areaPath =
    linePath +
    ` L${xAt(n - 1).toFixed(1)},${baselineY} L${xAt(0).toFixed(1)},${baselineY} Z`;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50 px-1 py-2 sm:px-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          className="h-[7.5rem] min-w-full"
          style={{ width: "100%", maxWidth: "100%" }}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label="Hourly temperature and conditions for the rest of today"
        >
          {ticks.map((tick) => {
            const y = yForValue(tick, scaleMin, scaleMax);
            return (
              <g key={tick}>
                <line
                  x1={YLAB_W}
                  y1={y}
                  x2={totalW - 4}
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
                  {Math.round(tick)}°
                </text>
              </g>
            );
          })}
          <defs>
            <linearGradient id="weatherTempFill" x1="0" y1={ICON_H} x2="0" y2={baselineY}>
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#weatherTempFill)" opacity={0.35} />
          <path
            d={linePath}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {displayHours.map((h, i) => {
            const x = xAt(i);
            const y = yForValue(h.temperatureF, scaleMin, scaleMax);
            const label = hourLabel(h.time);
            return (
              <g key={h.time}>
                <title>
                  {label} — {Math.round(h.temperatureF)}°F, {wmoLabel(h.code)}
                </title>
                <foreignObject
                  x={x - 12}
                  y={2}
                  width={24}
                  height={24}
                  className="overflow-visible"
                >
                  <div className="flex h-6 w-6 items-center justify-center text-slate-200">
                    <WeatherIcon code={h.code} className="h-5 w-5" />
                  </div>
                </foreignObject>
                <circle cx={x} cy={y} r={2.5} fill="#7dd3fc" stroke="#0ea5e9" strokeWidth={1} />
                {shouldShowHourLabel(i, n) ? (
                  <text
                    x={x}
                    y={ICON_H + PLOT_H + 12}
                    textAnchor="middle"
                    className="fill-slate-500 text-[10px]"
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
