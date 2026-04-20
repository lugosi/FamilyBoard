import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import {
  getCalendarClient,
  getDefaultCalendarId,
  getDefaultTimeZone,
  getOAuth2WithRefresh,
} from "@/lib/google";

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
  start?: string;
  end?: string;
  calendarId?: string;
};

export async function POST(request: Request) {
  let body: NewEventBody;
  try {
    body = (await request.json()) as NewEventBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.summary?.trim() || !body.start || !body.end) {
    return NextResponse.json(
      { error: "summary, start, and end are required" },
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
    const created = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: body.summary.trim(),
        start: { dateTime: body.start, timeZone: tz },
        end: { dateTime: body.end, timeZone: tz },
      },
    });
    return NextResponse.json({ event: created.data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
