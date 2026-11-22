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

/** Human-ish one-liner for Tools UI (not a full English rewriter). */
export function describeCron(expr: string): string {
  const parsed = parseCron(expr);
  if (!parsed) return "invalid cron";
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
    return `daily at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
    const days = [...dows].sort((a, b) => a - b).map((d) => names[d]).join(",");
    return `${days} at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  if (
    mins.size === 1 &&
    [...mins][0] === 0 &&
    everyHour &&
    everyDom &&
    everyMonth &&
    everyDow
  ) {
    return "hourly";
  }

  return expr.trim();
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
