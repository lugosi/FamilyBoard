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

const HOUR_COUNT = 12;
const SLOT_W = 40;
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

function shouldShowHourLabel(index: number): boolean {
  return index === 0 || index === HOUR_COUNT - 1 || index % 2 === 0;
}

export function WeatherHourlyChart({ hours }: Props) {
  const displayHours = useMemo(() => hours.slice(0, HOUR_COUNT), [hours]);

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
          aria-label="Next 12 hours temperature and conditions"
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
                {shouldShowHourLabel(i) ? (
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
