/**
 * Pure helpers for the 7am Pacific morning brief (scheduling + text layout).
 * No I/O — unit-tested from scripts/daily-brief.test.mjs.
 */

/** Default “what’s included” copy for the built-in Morning brief scheduler item. */
export const DEFAULT_MORNING_BRIEF_PROMPT =
  "Calendar, weather, open todos, and house alerts that need attention.";

export type BriefEvent = {
  summary: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
};

export type BriefTodo = {
  title: string;
  dueHint?: string;
};

export type BriefHouseAttention = {
  title: string;
  status: string;
};

export type MorningBriefParts = {
  dateKey: string;
  timeZone: string;
  headline: string;
  weatherLine?: string;
  events: BriefEvent[];
  todos: BriefTodo[];
  houseAttention: BriefHouseAttention[];
};

export function zonedClockParts(
  now: Date,
  timeZone: string,
): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function dateKeyInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function weekdayLongInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

/**
 * Fire once per local calendar day after the configured local hour:minute.
 * Catches up if the server was down at exactly 7:00.
 */
export function shouldSendDailyBrief(
  now: Date,
  opts: {
    timeZone: string;
    hour: number;
    minute: number;
    lastSentDateKey: string | null;
  },
): boolean {
  const dateKey = dateKeyInZone(now, opts.timeZone);
  if (opts.lastSentDateKey === dateKey) return false;
  const clock = zonedClockParts(now, opts.timeZone);
  const nowMins = clock.hour * 60 + clock.minute;
  const targetMins = opts.hour * 60 + opts.minute;
  return nowMins >= targetMins;
}

function formatEventWhen(ev: BriefEvent, timeZone: string): string {
  if (ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(ev.start)) return "all day";
  const hasOffset = /(Z|[+-]\d{2}:\d{2})$/.test(ev.start);
  const date = new Date(hasOffset ? ev.start : `${ev.start}Z`);
  if (Number.isNaN(date.getTime())) return ev.start;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: hasOffset ? timeZone : "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Deterministic brief body (Slack mrkdwn-friendly; board markdown-friendly). */
export function formatMorningBrief(
  parts: MorningBriefParts,
  channel: "slack" | "board",
): string {
  const bold = (s: string) => (channel === "slack" ? `*${s}*` : `**${s}**`);
  const lines: string[] = [];
  lines.push(`${bold(parts.headline)}`);
  if (parts.weatherLine) lines.push(parts.weatherLine);
  lines.push("");

  lines.push(bold("Today"));
  if (!parts.events.length) {
    lines.push("• No calendar events");
  } else {
    for (const ev of parts.events.slice(0, 20)) {
      const when = formatEventWhen(ev, parts.timeZone);
      const loc = ev.location?.trim() ? ` · ${ev.location.trim()}` : "";
      lines.push(`• ${when} — ${ev.summary.trim() || "(untitled)"}${loc}`);
    }
  }

  lines.push("");
  lines.push(bold("Todos"));
  if (!parts.todos.length) {
    lines.push("• None open");
  } else {
    for (const t of parts.todos.slice(0, 12)) {
      const due = t.dueHint?.trim() ? ` (${t.dueHint.trim()})` : "";
      lines.push(`• ${t.title.trim()}${due}`);
    }
  }

  if (parts.houseAttention.length) {
    lines.push("");
    lines.push(bold("House needs attention"));
    for (const h of parts.houseAttention.slice(0, 8)) {
      lines.push(`• ${h.title}: ${h.status}`);
    }
  }

  return lines.join("\n").trim();
}

export function parseSlackUserIdList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const ids = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const id = part.trim().toUpperCase();
    if (/^U[A-Z0-9]+$/.test(id)) ids.add(id);
  }
  return [...ids];
}
