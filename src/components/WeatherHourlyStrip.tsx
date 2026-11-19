"use client";

import { WeatherIcon } from "@/components/WeatherIcon";
import {
  HOURLY_STRIP_HOURS,
  isNightForWeatherIconAt,
  type SunTimes,
} from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

export type WeatherHourlyStripPoint = {
  time: string;
  temperatureF: number;
  code: number;
  precipChance?: number;
};

type Props = {
  hours: WeatherHourlyStripPoint[];
  sunByDate?: Record<string, SunTimes>;
  className?: string;
};

function hourLabel(time: string): string {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return (time ?? "").slice(11, 16);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

export function WeatherHourlyStrip({
  hours,
  sunByDate,
  className = "",
}: Props) {
  const displayHours = hours.slice(0, HOURLY_STRIP_HOURS);
  if (displayHours.length === 0) {
    return (
      <p className="text-sm text-slate-500 sm:text-base">
        Hourly forecast not available yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 sm:text-sm">
        Next hours
      </p>
      <div
        className="board-scrollbar -mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1"
        role="list"
        aria-label="Hourly forecast"
      >
        {displayHours.map((h, i) => {
          const isNight = isNightForWeatherIconAt(h.time, sunByDate);
          const precip =
            typeof h.precipChance === "number" && h.precipChance > 0
              ? h.precipChance
              : null;
          const label = hourLabel(h.time);
          return (
            <div
              key={h.time}
              role="listitem"
              title={`${label} — ${Math.round(h.temperatureF)}°F, ${wmoLabel(h.code)}${
                precip != null ? `, ${precip}% rain` : ""
              }`}
              className={`flex w-[3.15rem] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 sm:w-[3.4rem] ${
                i === 0
                  ? "border border-sky-500/40 bg-sky-950/40"
                  : "border border-transparent bg-slate-950/40"
              }`}
            >
              <span
                className={`text-[11px] tabular-nums sm:text-xs ${
                  i === 0 ? "font-semibold text-sky-100" : "text-slate-400"
                }`}
              >
                {i === 0 ? "Now" : label}
              </span>
              <WeatherIcon
                code={h.code}
                isNight={isNight}
                className="h-6 w-6 text-slate-100 sm:h-7 sm:w-7"
              />
              <span className="text-sm font-semibold tabular-nums text-white sm:text-base">
                {Math.round(h.temperatureF)}°
              </span>
              <span
                className={`text-[10px] tabular-nums sm:text-[11px] ${
                  precip != null && precip >= 30
                    ? "font-medium text-sky-300"
                    : "text-slate-600"
                }`}
              >
                {precip != null ? `${precip}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
