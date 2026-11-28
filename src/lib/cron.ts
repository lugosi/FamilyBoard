/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports *, N, A-B, star/N steps, A,B,C and combinations. No I/O — unit-tested.
 */

export type CronParts = {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
};

const FIELD_BOUNDS: { min: number; max: number }[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (7 = Sunday alias)
];

function parseField(raw: string, bounds: { min: number; max: number }): Set<number> | null {
  const field = raw.trim();
  if (!field) return null;
  const out = new Set<number>();

  for (const part of field.split(",")) {
    const token = part.trim();
    if (!token) return null;

    let rangeStart: number;
    let rangeEnd: number;
    let step = 1;

    const stepSplit = token.split("/");
    if (stepSplit.length > 2) return null;
    if (stepSplit.length === 2) {
      step = Number(stepSplit[1]);
      if (!Number.isInteger(step) || step < 1) return null;
    }
    const rangePart = stepSplit[0];

    if (rangePart === "*") {
      rangeStart = bounds.min;
      rangeEnd = bounds.max;
    } else if (rangePart.includes("-")) {
      const [a, b, ...rest] = rangePart.split("-");
      if (rest.length) return null;
      rangeStart = Number(a);
      rangeEnd = Number(b);
      if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd)) return null;
      if (rangeStart > rangeEnd) return null;
    } else {
      rangeStart = Number(rangePart);
      rangeEnd = rangeStart;
      if (!Number.isInteger(rangeStart)) return null;
    }

    if (rangeStart < bounds.min || rangeEnd > bounds.max) return null;
    for (let n = rangeStart; n <= rangeEnd; n += step) out.add(n);
  }

  return out;
}

/** Returns null when the expression is invalid. */
export function parseCron(expr: string): [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>] | null {
  const trimmed = expr.trim().replace(/\s+/g, " ");
  const bits = trimmed.split(" ");
  if (bits.length !== 5) return null;
  const parsed: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(bits[i], FIELD_BOUNDS[i]);
    if (!set || set.size === 0) return null;
    parsed.push(set);
  }
  // Normalize Sunday: accept both 0 and 7
  const dow = parsed[4];
  if (dow.has(7)) {
    dow.add(0);
    dow.delete(7);
  }
  return parsed as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

export function cronMatches(expr: string, parts: CronParts): boolean {
  const parsed = parseCron(expr);
  if (!parsed) return false;
  const [mins, hours, doms, months, dows] = parsed;
  if (!mins.has(parts.minute)) return false;
  if (!hours.has(parts.hour)) return false;
  if (!months.has(parts.month)) return false;
  if (!doms.has(parts.dayOfMonth)) return false;
  if (!dows.has(parts.dayOfWeek)) return false;
  return true;
}

/** Friendly schedule chips for Tools UI (still stored as 5-field cron). */
export const SCHEDULE_PRESETS = [
  {
    id: "early-morning",
    label: "7:00 morning",
    hint: "Around 7:00 (classic morning brief)",
    cron: "0 7 * * *",
  },
  {
    id: "daily-morning",
    label: "Every morning",
    hint: "Around 9:00",
    cron: "0 9 * * *",
  },
  {
    id: "weekdays",
    label: "Weekday mornings",
    hint: "Mon–Fri at 9:00",
    cron: "0 9 * * 1-5",
  },
  {
    id: "twice-daily",
    label: "Morning & evening",
    hint: "9:00 and 6:00 pm",
    cron: "0 9,18 * * *",
  },
  {
    id: "every-6h",
    label: "A few times a day",
    hint: "Every 6 hours",
    cron: "0 */6 * * *",
  },
  {
    id: "hourly",
    label: "Every hour",
    hint: "On the hour",
    cron: "0 * * * *",
  },
] as const;

export type SchedulePresetId = (typeof SCHEDULE_PRESETS)[number]["id"] | "custom";

export function cronForSchedulePreset(id: Exclude<SchedulePresetId, "custom">): string {
  const hit = SCHEDULE_PRESETS.find((p) => p.id === id);
  return hit?.cron ?? "0 9 * * *";
}

export function schedulePresetForCron(expr: string): SchedulePresetId {
  const normalized = expr.trim().replace(/\s+/g, " ");
  const hit = SCHEDULE_PRESETS.find((p) => p.cron === normalized);
  return hit?.id ?? "custom";
}

/** Human-ish one-liner for Tools UI (not a full English rewriter). */
export function describeCron(expr: string): string {
  const preset = schedulePresetForCron(expr);
  if (preset !== "custom") {
    const hit = SCHEDULE_PRESETS.find((p) => p.id === preset);
    if (hit) return hit.label;
  }

  const parsed = parseCron(expr);
  if (!parsed) return "custom schedule";
  const [mins, hours, doms, months, dows] = parsed;
  const everyMin = mins.size === 60;
  const everyHour = hours.size === 24;
  const everyDom = doms.size === 31;
  const everyMonth = months.size === 12;
  const everyDow = dows.size === 7;

  if (everyMin && everyHour && everyDom && everyMonth && everyDow) return "every minute";

  if (
    mins.size === 1 &&
    hours.size === 1 &&
    everyDom &&
    everyMonth &&
    everyDow
  ) {
    const m = [...mins][0];
    const h = [...hours][0];
    return `daily at ${formatClock(h, m)}`;
  }

  if (
    mins.size === 1 &&
    hours.size > 1 &&
    everyDom &&
    everyMonth &&
    everyDow
  ) {
    const m = [...mins][0];
    const clocks = [...hours]
      .sort((a, b) => a - b)
      .map((h) => formatClock(h, m))
      .join(" & ");
    return `daily at ${clocks}`;
  }

  if (
    mins.size === 1 &&
    hours.size === 1 &&
    everyDom &&
    everyMonth &&
    !everyDow
  ) {
    const m = [...mins][0];
    const h = [...hours][0];
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = [...dows].sort((a, b) => a - b).map((d) => names[d]).join(", ");
    return `${days} at ${formatClock(h, m)}`;
  }

  if (
    mins.size === 1 &&
    [...mins][0] === 0 &&
    everyHour &&
    everyDom &&
    everyMonth &&
    everyDow
  ) {
    return "every hour";
  }

  // */N hour patterns with minute 0
  if (
    mins.size === 1 &&
    [...mins][0] === 0 &&
    hours.size > 1 &&
    hours.size < 24 &&
    everyDom &&
    everyMonth &&
    everyDow
  ) {
    const sorted = [...hours].sort((a, b) => a - b);
    const step = sorted.length >= 2 ? sorted[1] - sorted[0] : 0;
    if (step > 0 && sorted.every((h, i) => h === sorted[0] + i * step)) {
      return `every ${step} hours`;
    }
  }

  return "custom schedule";
}

function formatClock(hour: number, minute: number): string {
  const d = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    ...(minute === 0 ? {} : { minute: "2-digit" as const }),
  }).format(d);
}

export function zonedCronParts(now: Date, timeZone: string): CronParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    dayOfMonth: Number(get("day")),
    month: Number(get("month")),
    dayOfWeek: dowMap[weekday] ?? 0,
  };
}

/**
 * Most recent cron minute at or before `now`, within `lookbackMinutes`.
 * The 1-minute ticker often misses the exact minute (restart, a slow job).
 * Callers use this to send that run once instead of waiting for the next day.
 */
export function latestMatchingCronSlot(
  expr: string,
  now: Date,
  timeZone: string,
  lookbackMinutes = 20 * 60,
): string | null {
  if (!isValidCron(expr)) return null;
  const span = Math.max(0, Math.floor(lookbackMinutes));
  for (let i = 0; i <= span; i++) {
    const t = new Date(now.getTime() - i * 60_000);
    if (!cronMatches(expr, zonedCronParts(t, timeZone))) continue;
    return cronSlotKey(t, timeZone);
  }
  return null;
}

/**
 * Slot to run now, or null. Skips slots before the monitor existed and slots
 * already covered by `lastRunSlot` (a later manual run counts).
 */
export function dueCronSlot(
  expr: string,
  now: Date,
  timeZone: string,
  lastRunSlot: string | null,
  notBeforeSlot: string | null = null,
  lookbackMinutes = 20 * 60,
): string | null {
  const slot = latestMatchingCronSlot(expr, now, timeZone, lookbackMinutes);
  if (!slot) return null;
  if (notBeforeSlot && slot < notBeforeSlot) return null;
  if (lastRunSlot && lastRunSlot >= slot) return null;
  return slot;
}

/** Stable slot id so a 1-min ticker does not double-fire the same cron minute. */
export function cronSlotKey(now: Date, timeZone: string): string {
  const p = zonedCronParts(now, timeZone);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${ymd}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
