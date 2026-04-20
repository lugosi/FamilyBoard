import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import {
  getCalendarClient,
  getDefaultCalendarId,
  getDefaultTimeZone,
  getOAuth2WithRefresh,
} from "@/lib/google";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const calendarId = url.searchParams.get("calendarId")?.trim() || getDefaultCalendarId();
  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing from or to (ISO timestamps)" },
      { status: 400 },
    );
  }

  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    if (calendarId === "__all__") {
      const listRes = await calendar.calendarList.list({ maxResults: 250 });
      const sources = (listRes.data.items ?? []).filter((c) => c.id);
      const batches = await Promise.all(
        sources.map(async (src) => {
          const evRes = await calendar.events.list({
            calendarId: src.id!,
            timeMin: from,
            timeMax: to,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
          });
          return (evRes.data.items ?? []).map((ev) => ({
            ...ev,
            sourceCalendarId: src.id,
            sourceCalendarSummary: src.summary ?? src.id,
            sourceCalendarColor: src.backgroundColor ?? null,
          }));
        }),
      );
      const events = batches
        .flat()
        .sort(
          (a, b) =>
            new Date(a.start?.dateTime ?? a.start?.date ?? 0).getTime() -
            new Date(b.start?.dateTime ?? b.start?.date ?? 0).getTime(),
        );
      return NextResponse.json({ events });
    }

    const res = await calendar.events.list({
      calendarId,
      timeMin: from,
      timeMax: to,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });
    const events = (res.data.items ?? []).map((ev) => ({
      ...ev,
      sourceCalendarId: calendarId,
      sourceCalendarSummary: calendarId,
      sourceCalendarColor: null,
    }));
    return NextResponse.json({ events });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

type NewEventBody = {
  summary?: string;
  /** Timed: ISO strings */
  start?: string;
  end?: string;
  /** All-day: `endDate` is exclusive (day after last day). */
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
  calendarId?: string;
};

export async function POST(request: Request) {
  let body: NewEventBody;
  try {
    body = (await request.json()) as NewEventBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const summary = body.summary?.trim();
  const hasAllDay =
    body.allDay === true &&
    typeof body.startDate === "string" &&
    typeof body.endDate === "string";
  const hasTimed = Boolean(body.start && body.end);

  if (!summary) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }
  if (!hasTimed && !hasAllDay) {
    return NextResponse.json(
      {
        error:
          "Provide start and end (timed), or allDay with startDate and endDate (end date exclusive).",
      },
      { status: 400 },
    );
  }

  const tz = getDefaultTimeZone();
  const calendarId = body.calendarId?.trim() || getDefaultCalendarId();
  if (calendarId === "__all__") {
    return NextResponse.json(
      { error: "Choose a specific calendar to create events." },
      { status: 400 },
    );
  }
  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);

    let requestBody: {
      summary: string;
      start: { dateTime: string; timeZone: string } | { date: string };
      end: { dateTime: string; timeZone: string } | { date: string };
    };

    if (hasAllDay) {
      if (!DATE_KEY.test(body.startDate!) || !DATE_KEY.test(body.endDate!)) {
        return NextResponse.json(
          { error: "startDate and endDate must be YYYY-MM-DD" },
          { status: 400 },
        );
      }
      if (body.endDate! <= body.startDate!) {
        return NextResponse.json(
          { error: "endDate must be after startDate (end is exclusive)" },
          { status: 400 },
        );
      }
      requestBody = {
        summary,
        start: { date: body.startDate! },
        end: { date: body.endDate! },
      };
    } else {
      requestBody = {
        summary,
        start: { dateTime: body.start!, timeZone: tz },
        end: { dateTime: body.end!, timeZone: tz },
      };
    }

    const created = await calendar.events.insert({
      calendarId,
      requestBody,
    });
    return NextResponse.json({ event: created.data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
