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
const ICON_SIZE = 18;
const ICON_GAP = 4;
const PLOT_H = 96;
const LABEL_H = 14;
const YLAB_W = 30;
/** Space above the warmest point so icons sit above dots without clipping. */
const PAD_TOP = ICON_SIZE + ICON_GAP + 2;
const PAD_BOTTOM = 2;

function hourLabel(time: string): string {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return (time ?? "").slice(11, 16);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

function yForValue(value: number, yMin: number, yMax: number): number {
  const inner = PLOT_H - PAD_TOP - PAD_BOTTOM;
  const span = Math.max(yMax - yMin, 1);
  return PAD_TOP + inner - ((value - yMin) / span) * inner;
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
  const totalH = PLOT_H + LABEL_H;
  const xAt = (i: number) => YLAB_W + SLOT_W / 2 + i * SLOT_W;

  const linePath = displayHours
    .map((h, i) => {
      const x = xAt(i);
      const y = yForValue(h.temperatureF, scaleMin, scaleMax);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const baselineY = PLOT_H - PAD_BOTTOM;
  const areaPath =
    linePath +
    ` L${xAt(n - 1).toFixed(1)},${baselineY} L${xAt(0).toFixed(1)},${baselineY} Z`;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50 px-1 py-1 sm:px-1.5">
      <div className="h-[9.5rem] w-full overflow-x-auto sm:h-[10.5rem]">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          className="h-full min-w-full w-full"
          preserveAspectRatio="none"
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
            <linearGradient id="weatherTempFill" x1="0" y1={PAD_TOP} x2="0" y2={baselineY}>
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
            const iconY = y - ICON_SIZE - ICON_GAP;
            return (
              <g key={h.time}>
                <title>
                  {label} — {Math.round(h.temperatureF)}°F, {wmoLabel(h.code)}
                </title>
                <circle cx={x} cy={y} r={2.5} fill="#7dd3fc" stroke="#0ea5e9" strokeWidth={1} />
                <foreignObject
                  x={x - ICON_SIZE / 2}
                  y={iconY}
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  className="overflow-visible"
                >
                  <div
                    className="flex items-center justify-center text-slate-200"
                    style={{ width: ICON_SIZE, height: ICON_SIZE }}
                  >
                    <WeatherIcon code={h.code} className="h-4 w-4" />
                  </div>
                </foreignObject>
                {shouldShowHourLabel(i) ? (
                  <text
                    x={x}
                    y={PLOT_H + 11}
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
