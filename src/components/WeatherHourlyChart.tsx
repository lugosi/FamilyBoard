"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WeatherIcon } from "@/components/WeatherIcon";
import { isNightAt } from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

export type WeatherHourlyPoint = {
  time: string;
  temperatureF: number;
  code: number;
};

type Props = {
  hours: WeatherHourlyPoint[];
  sunriseToday?: string;
  sunsetToday?: string;
  className?: string;
};

const HOUR_COUNT = 12;
const ICON_SIZE = 20;
const ICON_GAP = 4;
const TEMP_LABEL_LINE = 11;
const LABEL_H = 14;
const YLAB_W = 30;
const PAD_TOP = ICON_SIZE + ICON_GAP + TEMP_LABEL_LINE + 2;
const PAD_BOTTOM = 4;
const DOT_R = 3;
const DOT_R_EXTREME = 4;

function hourLabel(time: string): string {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return (time ?? "").slice(11, 16);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

function shouldShowHourLabel(index: number, total: number): boolean {
  if (total <= 6) return true;
  if (index === 0 || index === total - 1) return true;
  return index % 2 === 0;
}

export function WeatherHourlyChart({
  hours,
  sunriseToday,
  sunsetToday,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 280, h: 128 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(Math.floor(rect.width), 160),
        h: Math.max(Math.floor(rect.height), 80),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[minIdx]!) minIdx = i;
    if (values[i]! > values[maxIdx]!) maxIdx = i;
  }

  const axisTicks: Array<{ value: number; kind: "high" | "low" | "mid" }> = [
    { value: dataMax, kind: "high" },
    { value: dataMin, kind: "low" },
  ];
  if (dataMax - dataMin >= 6) {
    axisTicks.splice(1, 0, {
      value: dataMin + (dataMax - dataMin) / 2,
      kind: "mid",
    });
  }

  const n = displayHours.length;
  const totalW = size.w;
  const totalH = size.h;
  const plotH = Math.max(totalH - LABEL_H, 48);
  const plotLeft = YLAB_W;
  const plotRight = totalW - 6;
  const plotInnerW = Math.max(plotRight - plotLeft, 40);

  const yForValue = (value: number) => {
    const inner = plotH - PAD_TOP - PAD_BOTTOM;
    const span = Math.max(yMax - yMin, 1);
    return PAD_TOP + inner - ((value - yMin) / span) * inner;
  };

  const xAt = (i: number) =>
    plotLeft + (n <= 1 ? plotInnerW / 2 : (i / (n - 1)) * plotInnerW);

  const linePath = displayHours
    .map((h, i) => {
      const x = xAt(i);
      const y = yForValue(h.temperatureF);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const baselineY = plotH - PAD_BOTTOM;
  const areaPath =
    linePath +
    ` L${xAt(n - 1).toFixed(1)},${baselineY} L${xAt(0).toFixed(1)},${baselineY} Z`;

  return (
    <div
      ref={containerRef}
      className={`relative min-h-[7.5rem] w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50 sm:min-h-[8.5rem] ${className}`}
    >
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="absolute inset-0 block h-full w-full"
        role="img"
        aria-label="Next 12 hours temperature and conditions"
      >
        {axisTicks.map((tick) => {
          const y = yForValue(tick.value);
          const isExtreme = tick.kind === "high" || tick.kind === "low";
          return (
            <g key={`${tick.kind}-${tick.value}`}>
              <line
                x1={plotLeft}
                y1={y}
                x2={plotRight}
                y2={y}
                stroke="currentColor"
                strokeOpacity={isExtreme ? 0.22 : 0.1}
                strokeWidth={isExtreme ? 1.25 : 1}
                className={tick.kind === "high" ? "text-amber-400" : tick.kind === "low" ? "text-sky-400" : "text-slate-400"}
              />
              <text
                x={plotLeft - 5}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className={
                  tick.kind === "high"
                    ? "fill-amber-200 text-[10px] font-bold"
                    : tick.kind === "low"
                      ? "fill-sky-200 text-[10px] font-bold"
                      : "fill-slate-500 text-[9px]"
                }
              >
                {Math.round(tick.value)}°
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
          const y = yForValue(h.temperatureF);
          const label = hourLabel(h.time);
          const isHigh = i === maxIdx;
          const isLow = i === minIdx;
          const isExtreme = isHigh || isLow;
          const dotR = isExtreme ? DOT_R_EXTREME : DOT_R;
          const tempLabel = `${Math.round(h.temperatureF)}°`;
          const tempLabelY = y - dotR - ICON_GAP - TEMP_LABEL_LINE / 2;
          const iconY = isExtreme
            ? tempLabelY - TEMP_LABEL_LINE / 2 - ICON_GAP - ICON_SIZE
            : y - dotR - ICON_GAP - ICON_SIZE;
          return (
            <g key={h.time}>
              <title>
                {label} — {Math.round(h.temperatureF)}°F, {wmoLabel(h.code)}
                {isHigh ? " (high)" : isLow ? " (low)" : ""}
              </title>
              <circle
                cx={x}
                cy={y}
                r={dotR}
                fill={isHigh ? "#fbbf24" : isLow ? "#38bdf8" : "#7dd3fc"}
                stroke={isHigh ? "#f59e0b" : isLow ? "#0ea5e9" : "#0284c7"}
                strokeWidth={isExtreme ? 2 : 1}
              />
              {isExtreme ? (
                <text
                  x={x}
                  y={tempLabelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={
                    isHigh
                      ? "fill-amber-100 text-[10px] font-bold"
                      : "fill-sky-100 text-[10px] font-bold"
                  }
                >
                  {tempLabel}
                </text>
              ) : null}
              <foreignObject
                x={x - ICON_SIZE / 2}
                y={Math.max(2, iconY)}
                width={ICON_SIZE}
                height={ICON_SIZE}
                className="overflow-visible"
              >
                <div
                  className="flex items-center justify-center text-slate-200"
                  style={{ width: ICON_SIZE, height: ICON_SIZE }}
                >
                  <WeatherIcon
                    code={h.code}
                    isNight={isNightAt(new Date(h.time), sunriseToday, sunsetToday)}
                    className="h-5 w-5"
                  />
                </div>
              </foreignObject>
              {shouldShowHourLabel(i, n) ? (
                <text
                  x={x}
                  y={plotH + LABEL_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`text-[10px] ${isExtreme ? "fill-slate-300 font-medium" : "fill-slate-500"}`}
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
