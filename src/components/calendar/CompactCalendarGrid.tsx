"use client";

import { useEffect, useState } from "react";
import { WeatherIcon } from "@/components/WeatherIcon";
import {
  addDays,
  allDayEventsForCompactDay,
  dateKeyLocal,
  displayInstantForTimedOnDay,
  eventColorDotClass,
  formatCompactTime,
  eventBarClass,
  timedEventsForCompactDay,
  type GEvent,
} from "@/lib/calendar-layout";
import type { DailyForecast } from "@/lib/weather";

const WEEKDAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const VISIBLE_TIMED = 4;

type Props = {
  weekStarts: Date[];
  events: GEvent[];
  /** Local YYYY-MM-DD keys from Open-Meteo daily forecast. */
  dailyForecastByDate?: Record<string, DailyForecast>;
  showCalendarSource?: boolean;
  /** Larger type and day cells when the layout has extra vertical room (e.g. alert dismissed). */
  comfortable?: boolean;
  onSelectEvent: (ev: GEvent) => void;
};

type SourceEvent = GEvent & {
  sourceCalendarSummary?: string;
  sourceCalendarColor?: string | null;
};

export function CompactCalendarGrid({
  weekStarts,
  events,
  dailyForecastByDate,
  showCalendarSource = false,
  comfortable = false,
  onSelectEvent,
}: Props) {
  const [visibleAllDayLimit, setVisibleAllDayLimit] = useState(2);

  useEffect(() => {
    function updateLimit() {
      const w = window.innerWidth;
      if (w < 640) {
        setVisibleAllDayLimit(1);
        return;
      }
      if (w < 1024) {
        setVisibleAllDayLimit(2);
        return;
      }
      setVisibleAllDayLimit(3);
    }
    updateLimit();
    window.addEventListener("resize", updateLimit);
    return () => window.removeEventListener("resize", updateLimit);
  }, []);

  const rootText = comfortable
    ? "text-[15px] leading-snug text-slate-200 sm:text-[16px]"
    : "text-[14px] leading-snug text-slate-200 sm:text-[15px]";
  const headText = comfortable
    ? "py-2 text-[14px] font-medium tracking-wide text-slate-500 sm:text-[15px]"
    : "py-1.5 text-[13px] font-medium tracking-wide text-slate-500 sm:text-[14px]";

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-black ${rootText}`}
    >
      <div className="grid shrink-0 grid-cols-7 border-b border-slate-700/90">
        {WEEKDAY.map((d, idx) => (
          <div
            key={d}
            className={`border-l border-slate-800 text-center first:border-l-0 ${
              idx >= 5 ? "bg-slate-900/45" : ""
            } ${headText}`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {weekStarts.map((ws) => (
          <div key={ws.getTime()} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <CompactWeekBlock
              weekStartMonday={ws}
              events={events}
              dailyForecastByDate={dailyForecastByDate}
              visibleAllDayLimit={visibleAllDayLimit}
              showCalendarSource={showCalendarSource}
              comfortable={comfortable}
              onSelectEvent={onSelectEvent}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactWeekBlock({
  weekStartMonday,
  events,
  dailyForecastByDate,
  visibleAllDayLimit,
  showCalendarSource,
  comfortable,
  onSelectEvent,
}: {
  weekStartMonday: Date;
  events: GEvent[];
  dailyForecastByDate?: Record<string, DailyForecast>;
  visibleAllDayLimit: number;
  showCalendarSource: boolean;
  comfortable: boolean;
  onSelectEvent: (ev: GEvent) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-800 last:border-b-0">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-7 grid-rows-[minmax(0,1fr)] divide-x divide-slate-800/90">
        {Array.from({ length: 7 }, (_, dayIndex) => {
          const weekend = dayIndex >= 5;
          const d = addDays(weekStartMonday, dayIndex);
          const key = dateKeyLocal(d);
          const today = key === dateKeyLocal(new Date());
          const allDayList = allDayEventsForCompactDay(events, d);
          const visibleAllDay = allDayList.slice(0, visibleAllDayLimit);
          const allDayMore = allDayList.length - visibleAllDay.length;
          const list = timedEventsForCompactDay(events, d);
          const visible = list.slice(0, VISIBLE_TIMED);
          const more = list.length - visible.length;

          const dayLabel =
            d.getDate() === 1
              ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : String(d.getDate());
          const dayForecast = dailyForecastByDate?.[key];

          const dayMinH = comfortable
            ? "min-h-[4.5rem] sm:min-h-[4.75rem]"
            : "min-h-[4rem] sm:min-h-[4.25rem]";

          return (
            <div
              key={key}
              className={`flex h-full min-h-0 min-w-0 flex-col gap-px p-0.5 ${dayMinH} ${
                today ? "bg-slate-900/40" : weekend ? "bg-slate-900/25" : ""
              }`}
            >
              <div
                className={`flex shrink-0 flex-col items-center justify-center gap-0.5 ${
                  comfortable ? "min-h-16 py-0.5" : "min-h-14 py-0.5"
                }`}
              >
                {today ? (
                  <span
                    className={`flex items-center justify-center rounded-full bg-blue-600 px-0.5 font-semibold text-white ${
                      comfortable
                        ? "h-9 min-w-[2.25rem] text-lg"
                        : "h-8 min-w-[2rem] text-base"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                ) : (
                  <span
                    className={`font-medium leading-none text-slate-300 ${
                      comfortable ? "text-lg" : "text-base"
                    }`}
                  >
                    {dayLabel}
                  </span>
                )}
                {dayForecast ? (
                  <div
                    className="flex items-center justify-center gap-0.5 leading-none"
                    title={`High ${Math.round(dayForecast.maxF)}° / low ${Math.round(dayForecast.minF)}°`}
                  >
                    <WeatherIcon
                      code={dayForecast.code}
                      className={comfortable ? "h-3.5 w-3.5 shrink-0" : "h-3 w-3 shrink-0"}
                    />
                    <span
                      className={`whitespace-nowrap tabular-nums ${
                        comfortable ? "text-[11px]" : "text-[10px]"
                      }`}
                    >
                      <span className="font-medium text-slate-200">
                        {Math.round(dayForecast.maxF)}°
                      </span>
                      <span className="text-slate-500">/</span>
                      <span className="text-slate-400">{Math.round(dayForecast.minF)}°</span>
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-px">
                {visibleAllDay.map((ev) => (
                  <button
                    key={ev.id ?? `${key}-all-${ev.summary ?? "untitled"}`}
                    type="button"
                    onClick={() => onSelectEvent(ev)}
                    className={`truncate rounded px-1 py-px text-left font-medium ${
                      comfortable ? "text-[13px]" : "text-[12px]"
                    } ${eventBarClass(ev.summary)}`}
                    style={
                      showCalendarSource
                        ? sourceCalendarBarStyle(ev as SourceEvent)
                        : undefined
                    }
                    title={ev.summary ?? ""}
                  >
                    {showCalendarSource ? `${shortCalendarLabel(ev as SourceEvent)} ` : ""}
                    {ev.summary || "(No title)"}
                  </button>
                ))}
                {allDayMore > 0 ? (
                  <span
                    className={`pl-2 text-slate-500 ${
                      comfortable ? "text-[13px]" : "text-[12px]"
                    }`}
                  >
                    {allDayMore} more all-day
                  </span>
                ) : null}
                {visible.map((ev) => {
                  const t = displayInstantForTimedOnDay(ev, d);
                  return (
                    <button
                      key={ev.id ?? `${key}-${ev.start?.dateTime}`}
                      type="button"
                      onClick={() => onSelectEvent(ev)}
                      className="flex min-w-0 items-start gap-0.5 rounded px-px text-left hover:bg-white/5"
                    >
                      <span
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          showCalendarSource
                            ? ""
                            : eventColorDotClass(ev.summary)
                        }`}
                        style={
                          showCalendarSource
                            ? sourceCalendarDotStyle(ev as SourceEvent)
                            : undefined
                        }
                      />
                      <span
                        className={`min-w-0 truncate text-slate-200 ${
                          comfortable ? "text-[15px]" : "text-[14px]"
                        }`}
                      >
                        <span className="text-slate-500">
                          {formatCompactTime(t)}{" "}
                        </span>
                        {showCalendarSource ? (
                          <span className="text-slate-400">
                            {shortCalendarLabel(ev as SourceEvent)}{" "}
                          </span>
                        ) : null}
                        {ev.summary || "(No title)"}
                      </span>
                    </button>
                  );
                })}
                {more > 0 ? (
                  <span
                    className={`pl-2 text-slate-500 ${comfortable ? "text-[13px]" : "text-[12px]"}`}
                  >
                    {more} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortCalendarLabel(ev: SourceEvent): string {
  const s = ev.sourceCalendarSummary?.trim();
  if (!s) return "";
  if (s.length <= 12) return `[${s}]`;
  return `[${s.slice(0, 11)}…]`;
}

function sourceCalendarDotStyle(ev: SourceEvent): { backgroundColor: string } {
  return { backgroundColor: ev.sourceCalendarColor ?? "#6b7280" };
}

function sourceCalendarBarStyle(ev: SourceEvent): {
  backgroundColor?: string;
  borderColor?: string;
} {
  if (!ev.sourceCalendarColor) return {};
  return {
    backgroundColor: ev.sourceCalendarColor,
    borderColor: ev.sourceCalendarColor,
  };
}
