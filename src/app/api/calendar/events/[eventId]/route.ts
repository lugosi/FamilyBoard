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
  start?: string;
  end?: string;
};

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
  if (!body.summary && !body.start && !body.end) {
    return NextResponse.json(
      { error: "Provide summary and/or start and end" },
      { status: 400 },
    );
  }

  const tz = getDefaultTimeZone();
  const patch: Record<string, unknown> = {};
  if (body.summary !== undefined) patch.summary = body.summary;
  if (body.start) patch.start = { dateTime: body.start, timeZone: tz };
  if (body.end) patch.end = { dateTime: body.end, timeZone: tz };

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
