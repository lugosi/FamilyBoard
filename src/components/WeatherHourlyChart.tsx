"use client";

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

const PLOT_H = 80;
const YLAB_W = 34;
const PLOT_W = 260;
const TOTAL_W = YLAB_W + PLOT_W;
const PAD_TOP = 6;
const PAD_BOTTOM = 4;

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

export function WeatherHourlyChart({ hours }: Props) {
  if (hours.length < 2) {
    return (
      <p className="text-xs text-slate-500 sm:text-sm">Hourly forecast not available yet.</p>
    );
  }

  const values = hours.map((h) => h.temperatureF);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const pad = Math.max((dataMax - dataMin) * 0.12, 2);
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const ticks = scaleTicks(yMin, yMax);
  const scaleMin = ticks[0] ?? yMin;
  const scaleMax = ticks[ticks.length - 1] ?? yMax;

  const innerW = PLOT_W - 8;
  const n = hours.length;
  const xAt = (i: number) => YLAB_W + 4 + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const linePath = hours
    .map((h, i) => {
      const x = xAt(i);
      const y = yForValue(h.temperatureF, scaleMin, scaleMax);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPath =
    linePath +
    ` L${xAt(n - 1).toFixed(1)},${PLOT_H - PAD_BOTTOM} L${xAt(0).toFixed(1)},${PLOT_H - PAD_BOTTOM} Z`;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-1 py-2 sm:px-2">
      <div
        className="relative mb-1 grid w-full"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {hours.map((h) => (
          <div
            key={h.time}
            className="flex flex-col items-center justify-end gap-0.5 px-0.5"
            title={`${hourLabel(h.time)} — ${Math.round(h.temperatureF)}°F, ${wmoLabel(h.code)}`}
          >
            <WeatherIcon code={h.code} className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${TOTAL_W} ${PLOT_H}`}
        className="h-[5rem] w-full sm:h-[5.5rem]"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Today's temperature forecast by hour"
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
                {Math.round(tick)}°
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="weatherTempFill" x1="0" y1="0" x2="0" y2="1">
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
        {hours.map((h, i) => (
          <circle
            key={h.time}
            cx={xAt(i)}
            cy={yForValue(h.temperatureF, scaleMin, scaleMax)}
            r={2.5}
            fill="#7dd3fc"
            stroke="#0ea5e9"
            strokeWidth={1}
          />
        ))}
      </svg>
      <div
        className="mt-0.5 grid w-full pl-[2.15rem] text-[10px] text-slate-500 sm:text-[11px]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {hours.map((h) => (
          <span key={`${h.time}-lbl`} className="truncate text-center">
            {hourLabel(h.time)}
          </span>
        ))}
      </div>
    </div>
  );
}
