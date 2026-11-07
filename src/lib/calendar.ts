import {
  getCalendarClient,
  getDefaultTimeZone,
  getOAuth2WithRefresh,
} from "./google";
import {
  addDaysToDateKey,
  defaultEndFromStart,
  isDateKey,
  toFamilyLocalDateTime,
} from "./calendar-time";

export { addDaysToDateKey, defaultEndFromStart, toFamilyLocalDateTime } from "./calendar-time";

export type CalendarEventSummary = {
  id: string;
  calendarId: string;
  calendar: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

export type EventTimeInput = {
  /** Timed events: local wall-clock time in DEFAULT_TIMEZONE (or ISO with offset). */
  start?: string;
  end?: string;
  /** All-day events: YYYY-MM-DD; endDate is exclusive. */
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
};

export type NewEventInput = EventTimeInput & {
  summary: string;
  calendarId?: string;
  location?: string;
  description?: string;
  sourceMessageId?: string;
};

export type EventPatchInput = EventTimeInput & {
  eventId: string;
  calendarId?: string;
  summary?: string;
  location?: string;
  description?: string;
};

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Local midnight of `dateKey` in `timeZone`, as a UTC ISO string. */
export function zonedDateKeyToIso(dateKey: string, timeZone: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset).toISOString();
}

export function todayDateKey(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalizeTimed(value: string, field: string): string {
  return toFamilyLocalDateTime(value, field);
}

function buildTimes(
  input: EventTimeInput,
  tz: string,
  required: boolean,
): {
  start?: { dateTime: string; timeZone: string } | { date: string };
  end?: { dateTime: string; timeZone: string } | { date: string };
} {
  if (input.allDay) {
    const startDate = input.startDate?.trim();
    if (!startDate || !isDateKey(startDate)) {
      throw new Error("All-day events need startDate as YYYY-MM-DD");
    }
    const endDate = input.endDate?.trim() || addDaysToDateKey(startDate, 1);
    if (!isDateKey(endDate)) throw new Error("endDate must be YYYY-MM-DD");
    if (endDate <= startDate) {
      throw new Error("endDate must be after startDate (end is exclusive)");
    }
    return { start: { date: startDate }, end: { date: endDate } };
  }
  if (!input.start && !input.end) {
    if (required) throw new Error("Provide start and end, or allDay with startDate");
    return {};
  }
  if (!input.start) {
    throw new Error("Timed events need a start (end defaults to +1 hour)");
  }
  const start = normalizeTimed(input.start, "start");
  const end = input.end ? normalizeTimed(input.end, "end") : defaultEndFromStart(start);
  return {
    start: { dateTime: start, timeZone: tz },
    end: { dateTime: end, timeZone: tz },
  };
}

async function client(redirectUri: string) {
  const auth = await getOAuth2WithRefresh(redirectUri);
  return getCalendarClient(auth);
}

/**
 * Where new events go when the user names no calendar. Must match Board's
 * `pickDefaultCalendarId` (prefers "berkeley") or agent-created events won't show on the board.
 */
export async function resolveDefaultCalendarId(redirectUri: string): Promise<string> {
  const explicit = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (explicit) return explicit;
  const calendars = await listCalendars(redirectUri);
  const berkeley = calendars.find(
    (c) => c.writable && c.summary.trim().toLowerCase() === "berkeley",
  );
  return berkeley?.id ?? calendars.find((c) => c.primary)?.id ?? "primary";
}

/**
 * Resolve a calendar id. For *new* events (`forceDefault`), always use Berkeley /
 * GOOGLE_CALENDAR_ID so the agent cannot write to primary by accident.
 */
async function resolveCalendarId(
  redirectUri: string,
  id?: string,
  opts?: { forceDefault?: boolean },
): Promise<string> {
  if (opts?.forceDefault) return resolveDefaultCalendarId(redirectUri);
  const trimmed = id?.trim();
  if (!trimmed || trimmed === "__all__") return resolveDefaultCalendarId(redirectUri);
  return trimmed;
}

export async function listCalendars(redirectUri: string) {
  const calendar = await client(redirectUri);
  const res = await calendar.calendarList.list({ maxResults: 250 });
  return (res.data.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id!,
      summary: c.summary ?? c.id!,
      primary: Boolean(c.primary),
      writable: c.accessRole === "owner" || c.accessRole === "writer",
    }));
}

/** Events across every calendar on the account; `toDate` is exclusive. */
export async function listEventsInRange(
  redirectUri: string,
  fromDate: string,
  toDate: string,
  opts?: { query?: string; max?: number },
): Promise<CalendarEventSummary[]> {
  if (!isDateKey(fromDate) || !isDateKey(toDate)) {
    throw new Error("from and to must be YYYY-MM-DD");
  }
  const tz = getDefaultTimeZone();
  const calendar = await client(redirectUri);
  const listRes = await calendar.calendarList.list({ maxResults: 250 });
  const sources = (listRes.data.items ?? []).filter((c) => c.id);
  const timeMin = zonedDateKeyToIso(fromDate, tz);
  const timeMax = zonedDateKeyToIso(toDate, tz);

  const batches = await Promise.all(
    sources.map(async (src) => {
      const evRes = await calendar.events.list({
        calendarId: src.id!,
        timeMin,
        timeMax,
        q: opts?.query?.trim() || undefined,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      });
      return (evRes.data.items ?? [])
        .filter((ev) => ev.id && ev.status !== "cancelled")
        .map(
          (ev): CalendarEventSummary => ({
            id: ev.id!,
            calendarId: src.id!,
            calendar: src.summary ?? src.id!,
            summary: ev.summary ?? "(no title)",
            start: ev.start?.dateTime ?? ev.start?.date ?? "",
            end: ev.end?.dateTime ?? ev.end?.date ?? "",
            allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
            location: ev.location ?? undefined,
          }),
        );
    }),
  );

  return batches
    .flat()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, opts?.max ?? 150);
}

export async function createCalendarEvent(
  redirectUri: string,
  input: NewEventInput,
) {
  const summary = input.summary?.trim();
  if (!summary) throw new Error("summary is required");
  const tz = getDefaultTimeZone();
  const times = buildTimes(input, tz, true);
  // New events always land on Berkeley (or GOOGLE_CALENDAR_ID), matching the board.
  const calendarId = await resolveCalendarId(redirectUri, input.calendarId, {
    forceDefault: true,
  });
  const calendar = await client(redirectUri);
  const created = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      location: input.location?.trim() || undefined,
      description: input.description?.trim() || undefined,
      ...times,
      ...(input.sourceMessageId
        ? {
            extendedProperties: {
              private: { familyboardGmailId: input.sourceMessageId },
            },
          }
        : {}),
    },
  });
  return {
    id: created.data.id ?? "",
    calendarId,
    summary,
    start: created.data.start?.dateTime ?? created.data.start?.date ?? "",
    end: created.data.end?.dateTime ?? created.data.end?.date ?? "",
    htmlLink: created.data.htmlLink ?? undefined,
  };
}

export async function updateCalendarEvent(
  redirectUri: string,
  input: EventPatchInput,
) {
  if (!input.eventId?.trim()) throw new Error("eventId is required");
  const tz = getDefaultTimeZone();
  const patch: Record<string, unknown> = { ...buildTimes(input, tz, false) };
  if (input.summary?.trim()) patch.summary = input.summary.trim();
  if (input.location !== undefined) patch.location = input.location.trim();
  if (input.description !== undefined) {
    patch.description = input.description.trim();
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("Nothing to update");
  }
  const calendarId = await resolveCalendarId(redirectUri, input.calendarId);
  const calendar = await client(redirectUri);
  const updated = await calendar.events.patch({
    calendarId,
    eventId: input.eventId.trim(),
    requestBody: patch,
  });
  return {
    id: updated.data.id ?? input.eventId,
    calendarId,
    summary: updated.data.summary ?? "",
    start: updated.data.start?.dateTime ?? updated.data.start?.date ?? "",
    end: updated.data.end?.dateTime ?? updated.data.end?.date ?? "",
  };
}

export async function deleteCalendarEvent(
  redirectUri: string,
  input: { eventId: string; calendarId?: string },
) {
  if (!input.eventId?.trim()) throw new Error("eventId is required");
  const calendarId = await resolveCalendarId(redirectUri, input.calendarId);
  const calendar = await client(redirectUri);
  await calendar.events.delete({ calendarId, eventId: input.eventId.trim() });
  return { id: input.eventId, calendarId };
}
