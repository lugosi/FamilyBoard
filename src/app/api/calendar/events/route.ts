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
  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing from or to (ISO timestamps)" },
      { status: 400 },
    );
  }

  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    const calendarId = getDefaultCalendarId();
    const res = await calendar.events.list({
      calendarId,
      timeMin: from,
      timeMax: to,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });
    return NextResponse.json({ events: res.data.items ?? [] });
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
  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    const calendarId = getDefaultCalendarId();
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
