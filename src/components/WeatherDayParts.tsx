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
            className={`flex min-w-0 flex-col items-center rounded-lg px-1 py-1 leading-tight ${
              part.isCurrent
                ? "border border-sky-500/40 bg-sky-950/35"
                : "border border-slate-800/80 bg-slate-950/40"
            }`}
          >
            <span
              className={`text-xs font-medium sm:text-sm ${
                part.isCurrent ? "text-sky-100" : "text-slate-300"
              }`}
            >
              {part.label}
            </span>
            <span className="flex items-center gap-1">
              <WeatherIcon
                code={part.code}
                isNight={part.part === "night"}
                className="h-5 w-5 shrink-0 text-slate-100 sm:h-6 sm:w-6"
              />
              <span className="text-base font-semibold tabular-nums text-white sm:text-lg">
                {Math.round(part.temperatureF)}°
              </span>
            </span>
            {precip != null && precip >= 20 ? (
              <span className="text-xs tabular-nums text-sky-300 sm:text-sm">
                {precip}%
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
