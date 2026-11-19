"use client";

import { WeatherIcon } from "@/components/WeatherIcon";
import type { WeatherDayPart } from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

type Props = {
  parts: WeatherDayPart[];
  className?: string;
};

export function WeatherDayParts({ parts, className = "" }: Props) {
  if (parts.length === 0) return null;

  return (
    <div
      className={`grid grid-cols-3 gap-1.5 ${className}`}
      role="list"
      aria-label="Morning, afternoon, and night forecast"
    >
      {parts.map((part) => {
        const precip =
          typeof part.precipChance === "number" ? part.precipChance : null;
        return (
          <div
            key={part.id}
            role="listitem"
            title={`${part.label}: ${Math.round(part.temperatureF)}°F, ${wmoLabel(part.code)}${
              precip != null ? `, ${precip}% rain` : ""
            }`}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 ${
              part.isCurrent
                ? "border border-sky-500/40 bg-sky-950/35"
                : "border border-slate-800/80 bg-slate-950/40"
            }`}
          >
            <span
              className={`text-[11px] font-medium sm:text-xs ${
                part.isCurrent ? "text-sky-100" : "text-slate-400"
              }`}
            >
              {part.label}
            </span>
            <WeatherIcon
              code={part.code}
              isNight={part.part === "night"}
              className="h-6 w-6 text-slate-100 sm:h-7 sm:w-7"
            />
            <span className="text-sm font-semibold tabular-nums text-white sm:text-base">
              {Math.round(part.temperatureF)}°
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
  );
}
