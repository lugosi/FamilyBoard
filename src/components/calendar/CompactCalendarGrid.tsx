"use client";

import { useMemo } from "react";
import {
  addDays,
  dateKeyLocal,
  displayInstantForTimedOnDay,
  eventBarClass,
  eventColorDotClass,
  formatCompactTime,
  layoutAllDayBarsForWeek,
  timedEventsForCompactDay,
  type GEvent,
} from "@/lib/calendar-layout";

const WEEKDAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const VISIBLE_TIMED = 4;

type Props = {
  weekStarts: Date[];
  events: GEvent[];
  onSelectEvent: (ev: GEvent) => void;
};

export function CompactCalendarGrid({ weekStarts, events, onSelectEvent }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-black text-[11px] leading-tight text-slate-200">
      <div className="grid grid-cols-7 border-b border-slate-700/90">
        {WEEKDAY.map((d) => (
          <div
            key={d}
            className="border-l border-slate-800 py-1 text-center text-[10px] font-medium tracking-wide text-slate-500 first:border-l-0"
          >
            {d}
          </div>
        ))}
      </div>
      {weekStarts.map((ws) => (
        <CompactWeekBlock
          key={ws.getTime()}
          weekStartMonday={ws}
          events={events}
          onSelectEvent={onSelectEvent}
        />
      ))}
    </div>
  );
}

function CompactWeekBlock({
  weekStartMonday,
  events,
  onSelectEvent,
}: {
  weekStartMonday: Date;
  events: GEvent[];
  onSelectEvent: (ev: GEvent) => void;
}) {
  const bars = useMemo(
    () => layoutAllDayBarsForWeek(events, weekStartMonday),
    [events, weekStartMonday],
  );

  const maxLane = bars.reduce((m, b) => Math.max(m, b.lane), -1);
  const laneCount = maxLane + 1;

  return (
    <div className="border-b border-slate-800 last:border-b-0">
      {laneCount > 0 ? (
        <div className="space-y-px bg-slate-950/80 px-px pt-px">
          {Array.from({ length: laneCount }, (_, laneIndex) => {
            const inLane = bars.filter((b) => b.lane === laneIndex);
            return (
              <div
                key={laneIndex}
                className="grid min-h-[15px] grid-cols-7 border-b border-slate-900 bg-black/50"
              >
                {inLane.map((bar) => {
                  const span = bar.endCol - bar.startCol + 1;
                  return (
                    <button
                      key={`${bar.event.id ?? bar.event.summary}-${laneIndex}-${bar.startCol}`}
                      type="button"
                      onClick={() => onSelectEvent(bar.event)}
                      className={`mx-px truncate rounded px-0.5 py-px text-left text-[10px] font-medium shadow-sm ${eventBarClass(bar.event.summary)}`}
                      style={{
                        gridColumnStart: bar.startCol + 1,
                        gridColumnEnd: `span ${span}`,
                      }}
                      title={bar.event.summary ?? ""}
                    >
                      {bar.event.summary || "(No title)"}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-7 divide-x divide-slate-800/90">
        {Array.from({ length: 7 }, (_, dayIndex) => {
          const d = addDays(weekStartMonday, dayIndex);
          const key = dateKeyLocal(d);
          const today = key === dateKeyLocal(new Date());
          const list = timedEventsForCompactDay(events, d);
          const visible = list.slice(0, VISIBLE_TIMED);
          const more = list.length - visible.length;

          const dayLabel =
            d.getDate() === 1
              ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : String(d.getDate());

          return (
            <div
              key={key}
              className={`flex min-h-[5.25rem] flex-col gap-px p-0.5 ${
                today ? "bg-slate-900/40" : ""
              }`}
            >
              <div className="flex h-5 shrink-0 items-start justify-center">
                {today ? (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-0.5 text-[11px] font-medium text-white">
                    {d.getDate()}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">{dayLabel}</span>
                )}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-px">
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
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${eventColorDotClass(ev.summary)}`}
                      />
                      <span className="min-w-0 truncate text-[10px] text-slate-200">
                        <span className="text-slate-500">
                          {formatCompactTime(t)}{" "}
                        </span>
                        {ev.summary || "(No title)"}
                      </span>
                    </button>
                  );
                })}
                {more > 0 ? (
                  <span className="pl-2 text-[10px] text-slate-500">{more} more</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
