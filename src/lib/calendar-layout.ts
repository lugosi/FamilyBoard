import type { calendar_v3 } from "googleapis";

export type GEvent = calendar_v3.Schema$Event;

/** Local calendar week starting Monday (ISO-style). */
export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - daysSinceMonday);
  return x;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseLocalDateKey(key: string): Date {
  const [y, mo, da] = key.split("-").map(Number);
  return new Date(y, mo - 1, da);
}

export type EventBounds =
  | { kind: "timed"; start: Date; end: Date }
  | { kind: "allday"; startKey: string; endExclusiveKey: string };

export function getEventBounds(ev: GEvent): EventBounds | null {
  if (ev.start?.dateTime) {
    const start = new Date(ev.start.dateTime);
    const end = ev.end?.dateTime
      ? new Date(ev.end.dateTime)
      : new Date(start.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { kind: "timed", start, end };
  }
  if (ev.start?.date) {
    const startKey = ev.start.date;
    const endExclusiveKey =
      ev.end?.date ?? dateKeyLocal(addDays(parseLocalDateKey(startKey), 1));
    return { kind: "allday", startKey, endExclusiveKey };
  }
  return null;
}

const MS_DAY = 86400000;

export function enumerateWeekStarts(rangeFrom: Date, rangeTo: Date): Date[] {
  const first = startOfWeekMonday(rangeFrom);
  const last = startOfWeekMonday(rangeTo);
  const out: Date[] = [];
  for (let t = first.getTime(); t <= last.getTime(); t += 7 * MS_DAY) {
    out.push(new Date(t));
  }
  return out;
}

export type CalendarRangeKeys = { fromKey: string; toInclusiveKey: string };

export function defaultCalendarRangeKeys(weeksAhead = 4): CalendarRangeKeys {
  const ws = startOfWeekMonday(new Date());
  ws.setHours(0, 0, 0, 0);
  return {
    fromKey: dateKeyLocal(ws),
    toInclusiveKey: dateKeyLocal(addDays(ws, 7 * weeksAhead - 1)),
  };
}

export function rangeKeysToIso(keys: CalendarRangeKeys): { from: string; to: string } {
  return rangeFromPicker(keys.fromKey, keys.toInclusiveKey);
}

export function rangeFromPicker(fromYmd: string, toYmd: string): { from: string; to: string } {
  const a = startOfDay(parseLocalDateKey(fromYmd));
  const b = startOfDay(parseLocalDateKey(toYmd));
  if (b.getTime() < a.getTime()) {
    return { from: b.toISOString(), to: addDays(a, 1).toISOString() };
  }
  return { from: a.toISOString(), to: addDays(b, 1).toISOString() };
}

export function eventOverlapsLocalDay(ev: GEvent, day: Date): boolean {
  const b = getEventBounds(ev);
  if (!b) return false;
  const day0 = startOfDay(day);
  const day1 = addDays(day0, 1);
  if (b.kind === "allday") {
    const key = dateKeyLocal(day0);
    return b.startKey <= key && key < b.endExclusiveKey;
  }
  return b.start < day1 && b.end > day0;
}

/** Timed events on this calendar day, sorted by start time. */
export function timedEventsForCompactDay(events: GEvent[], day: Date): GEvent[] {
  const out: GEvent[] = [];
  for (const ev of events) {
    const b = getEventBounds(ev);
    if (!b || b.kind !== "timed") continue;
    if (eventOverlapsLocalDay(ev, day)) out.push(ev);
  }
  out.sort(
    (a, b) =>
      new Date(a.start?.dateTime ?? 0).getTime() -
      new Date(b.start?.dateTime ?? 0).getTime(),
  );
  return out;
}

/** All-day events on this calendar day, sorted by start date then title. */
export function allDayEventsForCompactDay(events: GEvent[], day: Date): GEvent[] {
  const out: Array<{ ev: GEvent; startKey: string; summary: string }> = [];
  for (const ev of events) {
    const b = getEventBounds(ev);
    if (!b || b.kind !== "allday") continue;
    if (!eventOverlapsLocalDay(ev, day)) continue;
    out.push({
      ev,
      startKey: b.startKey,
      summary: (ev.summary ?? "").toLowerCase(),
    });
  }
  out.sort((a, b) => {
    if (a.startKey !== b.startKey) return a.startKey.localeCompare(b.startKey);
    return a.summary.localeCompare(b.summary);
  });
  return out.map((x) => x.ev);
}

export type AllDayBarInWeek = {
  event: GEvent;
  startCol: number;
  endCol: number;
  lane: number;
};

/** Clip all-day event to Mon–Sun columns 0–6 for this week. */
export function clipAllDayBarToWeek(
  ev: GEvent,
  weekStartMonday: Date,
): { startCol: number; endCol: number } | null {
  const b = getEventBounds(ev);
  if (!b || b.kind !== "allday") return null;
  const ws = startOfDay(weekStartMonday);
  const weekLast = addDays(ws, 6);
  const weekStartKey = dateKeyLocal(ws);
  const weekEndExcl = dateKeyLocal(addDays(ws, 7));

  const lastInclusiveKey = dateKeyLocal(
    addDays(parseLocalDateKey(b.endExclusiveKey), -1),
  );

  const firstKey =
    b.startKey > weekStartKey ? b.startKey : weekStartKey;
  const lastKey =
    lastInclusiveKey < dateKeyLocal(weekLast)
      ? lastInclusiveKey
      : dateKeyLocal(weekLast);

  if (firstKey >= weekEndExcl || lastKey < weekStartKey || firstKey > lastKey) {
    return null;
  }

  const startCol = Math.max(
    0,
    Math.round(
      (parseLocalDateKey(firstKey).getTime() - ws.getTime()) / MS_DAY,
    ),
  );
  const endCol = Math.min(
    6,
    Math.round(
      (parseLocalDateKey(lastKey).getTime() - ws.getTime()) / MS_DAY,
    ),
  );
  if (startCol > endCol) return null;
  return { startCol, endCol };
}

function assignBarLanes(
  bars: { event: GEvent; startCol: number; endCol: number }[],
): AllDayBarInWeek[] {
  const sorted = [...bars].sort((a, b) => a.startCol - b.startCol);
  const laneEnds: number[] = [];
  const out: AllDayBarInWeek[] = [];
  for (const bar of sorted) {
    let lane = laneEnds.findIndex((end) => bar.startCol > end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endCol);
    } else {
      laneEnds[lane] = bar.endCol;
    }
    out.push({ ...bar, lane });
  }
  return out;
}

export function layoutAllDayBarsForWeek(
  events: GEvent[],
  weekStartMonday: Date,
): AllDayBarInWeek[] {
  const raw: { event: GEvent; startCol: number; endCol: number }[] = [];
  for (const ev of events) {
    const clipped = clipAllDayBarToWeek(ev, weekStartMonday);
    if (clipped) raw.push({ event: ev, ...clipped });
  }
  return assignBarLanes(raw);
}

export function displayInstantForTimedOnDay(ev: GEvent, day: Date): Date {
  const b = getEventBounds(ev);
  if (!b || b.kind !== "timed") return startOfDay(day);
  const day0 = startOfDay(day);
  return new Date(Math.max(b.start.getTime(), day0.getTime()));
}

export function formatCompactTime(d: Date): string {
  const mins = d.getHours() * 60 + d.getMinutes();
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  if (m === 0) return `${h12}${ap}`;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

export function eventColorClass(summary: string | null | undefined): string {
  const palette = [
    "bg-sky-600/90 border-sky-400/40",
    "bg-violet-600/90 border-violet-400/40",
    "bg-emerald-600/90 border-emerald-400/40",
    "bg-amber-600/90 border-amber-400/40",
    "bg-rose-600/90 border-rose-400/40",
    "bg-cyan-600/90 border-cyan-400/40",
  ];
  let h = 0;
  const s = summary ?? "";
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 997;
  return palette[h % palette.length]!;
}

export function eventColorDotClass(summary: string | null | undefined): string {
  const palette = [
    "bg-teal-400",
    "bg-violet-400",
    "bg-sky-400",
    "bg-amber-400",
    "bg-rose-400",
    "bg-cyan-400",
  ];
  let h = 0;
  const s = summary ?? "";
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 997;
  return palette[h % palette.length]!;
}

/** Muted horizontal bars (all-day) similar to Google month view. */
export function eventBarClass(summary: string | null | undefined): string {
  const palette = [
    "bg-teal-800/90 text-white border border-teal-600/40",
    "bg-violet-800/90 text-white border border-violet-600/40",
    "bg-sky-800/90 text-white border border-sky-600/40",
    "bg-amber-800/90 text-white border border-amber-600/40",
    "bg-rose-800/90 text-white border border-rose-600/40",
    "bg-cyan-800/90 text-white border border-cyan-600/40",
  ];
  let h = 0;
  const s = summary ?? "";
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 997;
  return palette[h % palette.length]!;
}
