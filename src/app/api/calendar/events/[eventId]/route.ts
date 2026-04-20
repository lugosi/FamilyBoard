import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import {
  getCalendarClient,
  getDefaultCalendarId,
  getDefaultTimeZone,
  getOAuth2WithRefresh,
} from "@/lib/google";

type PatchBody = {
  summary?: string;
  /** Timed event: ISO strings */
  start?: string;
  end?: string;
  /** All-day event: calendar dates (end is exclusive per Google Calendar). */
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await ctx.params;
  const calendarId =
    new URL(request.url).searchParams.get("calendarId")?.trim() ||
    getDefaultCalendarId();
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const hasTimed = Boolean(body.start || body.end);
  const hasAllDay =
    body.allDay === true &&
    typeof body.startDate === "string" &&
    typeof body.endDate === "string";

  if (!body.summary && !hasTimed && !hasAllDay) {
    return NextResponse.json(
      { error: "Provide summary and/or start and end (or all-day startDate/endDate)" },
      { status: 400 },
    );
  }

  const tz = getDefaultTimeZone();
  const patch: Record<string, unknown> = {};
  if (body.summary !== undefined) patch.summary = body.summary;

  if (hasAllDay) {
    if (!DATE_KEY.test(body.startDate!) || !DATE_KEY.test(body.endDate!)) {
      return NextResponse.json(
        { error: "startDate and endDate must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    patch.start = { date: body.startDate };
    patch.end = { date: body.endDate };
  } else {
    if (body.start) patch.start = { dateTime: body.start, timeZone: tz };
    if (body.end) patch.end = { dateTime: body.end, timeZone: tz };
  }

  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    const updated = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: patch,
    });
    return NextResponse.json({ event: updated.data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await ctx.params;
  const calendarId =
    new URL(request.url).searchParams.get("calendarId")?.trim() ||
    getDefaultCalendarId();
  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    await calendar.events.delete({ calendarId, eventId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
