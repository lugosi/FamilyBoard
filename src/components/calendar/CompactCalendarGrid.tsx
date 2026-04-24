"use client";

import { useEffect, useState } from "react";
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

const WEEKDAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const VISIBLE_TIMED = 4;

type Props = {
  weekStarts: Date[];
  events: GEvent[];
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
        {WEEKDAY.map((d) => (
          <div
            key={d}
            className={`border-l border-slate-800 text-center first:border-l-0 ${headText}`}
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
  visibleAllDayLimit,
  showCalendarSource,
  comfortable,
  onSelectEvent,
}: {
  weekStartMonday: Date;
  events: GEvent[];
  visibleAllDayLimit: number;
  showCalendarSource: boolean;
  comfortable: boolean;
  onSelectEvent: (ev: GEvent) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-800 last:border-b-0">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-7 grid-rows-[minmax(0,1fr)] divide-x divide-slate-800/90">
        {Array.from({ length: 7 }, (_, dayIndex) => {
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

          const dayMinH = comfortable
            ? "min-h-[3.75rem] sm:min-h-[4rem]"
            : "min-h-[3.25rem] sm:min-h-[3.5rem]";

          return (
            <div
              key={key}
              className={`flex h-full min-h-0 min-w-0 flex-col gap-px p-0.5 ${dayMinH} ${
                today ? "bg-slate-900/40" : ""
              }`}
            >
              <div
                className={`flex shrink-0 items-start justify-center ${
                  comfortable ? "h-8" : "h-7"
                }`}
              >
                {today ? (
                  <span
                    className={`flex items-center justify-center rounded-full bg-blue-600 px-0.5 font-medium text-white ${
                      comfortable
                        ? "h-7 min-w-[26px] text-base"
                        : "h-6 min-w-[22px] text-sm"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                ) : (
                  <span
                    className={`text-slate-400 ${comfortable ? "text-base" : "text-sm"}`}
                  >
                    {dayLabel}
                  </span>
                )}
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
