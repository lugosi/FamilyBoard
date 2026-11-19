"use client";

import { WeatherIcon } from "@/components/WeatherIcon";
import { DAILY_STRIP_DAYS, type DailyForecast } from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

type Props = {
  days: DailyForecast[];
  todayKey: string;
  className?: string;
};

function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey.slice(5);
  const tomorrow = new Date(`${todayKey}T12:00:00`);
  if (!Number.isNaN(tomorrow.getTime())) {
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    if (dateKey === tKey) return "Tom";
  }
  return d.toLocaleDateString([], { weekday: "short" });
}

export function WeatherDailyStrip({ days, todayKey, className = "" }: Props) {
  const display = days.slice(0, DAILY_STRIP_DAYS);
  if (display.length === 0) return null;

  const mins = display.map((d) => d.minF);
  const maxs = display.map((d) => d.maxF);
  const scaleMin = Math.min(...mins);
  const scaleMax = Math.max(...maxs);
  const span = Math.max(scaleMax - scaleMin, 1);

  return (
    <ul className={`space-y-1 ${className}`} aria-label="Daily forecast">
      {display.map((day) => {
        const label = dayLabel(day.date, todayKey);
        const left = ((day.minF - scaleMin) / span) * 100;
        const width = ((day.maxF - day.minF) / span) * 100;
        const precip =
          typeof day.precipChance === "number" ? day.precipChance : null;
        const isToday = day.date === todayKey;
        return (
          <li
            key={day.date}
            title={`${label}: ${wmoLabel(day.code)}, high ${Math.round(day.maxF)}°, low ${Math.round(day.minF)}°${
              precip != null ? `, ${precip}% rain` : ""
            }`}
            className={`grid grid-cols-[2.4rem_1.5rem_minmax(0,1fr)_2.25rem_1.9rem] items-center gap-1 rounded-md px-1 py-0.5 sm:grid-cols-[2.75rem_1.75rem_minmax(0,1fr)_2.5rem_2.1rem] sm:gap-1.5 ${
              isToday ? "bg-slate-950/60" : ""
            }`}
          >
            <span
              className={`truncate text-xs font-medium sm:text-sm ${
                isToday ? "text-white" : "text-slate-400"
              }`}
            >
              {label}
            </span>
            <WeatherIcon
              code={day.code}
              isNight={false}
              className="h-4 w-4 justify-self-center text-slate-100 sm:h-5 sm:w-5"
            />
            <div className="relative h-2 w-full rounded-full bg-slate-800/90">
              <div
                className="absolute top-0 h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-300"
                style={{
                  left: `${Math.max(0, left)}%`,
                  width: `${Math.max(width, 8)}%`,
                }}
              />
            </div>
            <span className="text-right text-xs tabular-nums text-slate-200 sm:text-sm">
              <span className="font-semibold text-white">
                {Math.round(day.maxF)}°
              </span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400">{Math.round(day.minF)}°</span>
            </span>
            <span
              className={`text-right text-[10px] tabular-nums sm:text-xs ${
                precip != null && precip >= 30
                  ? "font-medium text-sky-300"
                  : "text-slate-500"
              }`}
            >
              {precip != null ? `${precip}%` : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
