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
  const rootText = comfortable
    ? "text-[13px] leading-snug text-slate-200 sm:text-[14px]"
    : "text-[12px] leading-snug text-slate-200 sm:text-[13px]";
  const headText = comfortable
    ? "py-1.5 text-[12px] font-medium tracking-wide text-slate-500 sm:text-[13px]"
    : "py-1 text-[11px] font-medium tracking-wide text-slate-500 sm:text-[12px]";

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
  showCalendarSource,
  comfortable,
  onSelectEvent,
}: {
  weekStartMonday: Date;
  events: GEvent[];
  showCalendarSource: boolean;
  comfortable: boolean;
  onSelectEvent: (ev: GEvent) => void;
}) {
  const bars = useMemo(
    () => layoutAllDayBarsForWeek(events, weekStartMonday),
    [events, weekStartMonday],
  );

  const maxLane = bars.reduce((m, b) => Math.max(m, b.lane), -1);
  const laneCount = maxLane + 1;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-800 last:border-b-0">
      {laneCount > 0 ? (
        <div className="shrink-0 space-y-px bg-slate-950/80 px-px pt-px">
          {Array.from({ length: laneCount }, (_, laneIndex) => {
            const inLane = bars.filter((b) => b.lane === laneIndex);
            return (
              <div
                key={laneIndex}
                className={`grid grid-cols-7 border-b border-slate-900 bg-black/50 ${
                  comfortable ? "min-h-[20px]" : "min-h-[17px]"
                }`}
              >
                {inLane.map((bar) => {
                  const span = bar.endCol - bar.startCol + 1;
                  return (
                    <button
                      key={`${bar.event.id ?? bar.event.summary}-${laneIndex}-${bar.startCol}`}
                      type="button"
                      onClick={() => onSelectEvent(bar.event)}
                      className={`mx-px truncate rounded px-0.5 py-px text-left font-medium shadow-sm ${
                        comfortable ? "text-[12px]" : "text-[11px]"
                      } ${eventBarClass(bar.event.summary)}`}
                      // For "All calendars", use source calendar color for easier scanning.
                      style={{
                        gridColumnStart: bar.startCol + 1,
                        gridColumnEnd: `span ${span}`,
                        ...(showCalendarSource
                          ? sourceCalendarBarStyle(bar.event as SourceEvent)
                          : {}),
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

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-7 grid-rows-[minmax(0,1fr)] divide-x divide-slate-800/90">
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

          const dayMinH = comfortable
            ? "min-h-[3.5rem] sm:min-h-[3.75rem]"
            : "min-h-[3rem] sm:min-h-[3.25rem]";

          return (
            <div
              key={key}
              className={`flex h-full min-h-0 min-w-0 flex-col gap-px p-0.5 ${dayMinH} ${
                today ? "bg-slate-900/40" : ""
              }`}
            >
              <div
                className={`flex shrink-0 items-start justify-center ${
                  comfortable ? "h-7" : "h-6"
                }`}
              >
                {today ? (
                  <span
                    className={`flex items-center justify-center rounded-full bg-blue-600 px-0.5 font-medium text-white ${
                      comfortable
                        ? "h-6 min-w-[22px] text-sm"
                        : "h-5 min-w-[20px] text-xs"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                ) : (
                  <span
                    className={`text-slate-400 ${comfortable ? "text-sm" : "text-xs"}`}
                  >
                    {dayLabel}
                  </span>
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
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
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
                          comfortable ? "text-[13px]" : "text-[12px]"
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
                    className={`pl-2 text-slate-500 ${comfortable ? "text-[12px]" : "text-[11px]"}`}
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

function sourceCalendarBarStyle(
  ev: SourceEvent,
): { backgroundColor?: string; borderColor?: string } {
  if (!ev.sourceCalendarColor) return {};
  return {
    backgroundColor: ev.sourceCalendarColor,
    borderColor: ev.sourceCalendarColor,
  };
}
