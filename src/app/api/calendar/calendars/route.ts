import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getCalendarClient, getOAuth2WithRefresh } from "@/lib/google";

export async function GET(request: Request) {
  try {
    const auth = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const calendar = getCalendarClient(auth);
    const res = await calendar.calendarList.list({ maxResults: 250 });
    const calendars = (res.data.items ?? []).map((item) => ({
      id: item.id ?? "",
      summary: item.summary ?? item.id ?? "Calendar",
      primary: Boolean(item.primary),
      selected: Boolean(item.selected),
      accessRole: item.accessRole ?? "reader",
      backgroundColor: item.backgroundColor ?? null,
    }));

    return NextResponse.json({
      calendars: calendars.filter((c) => c.id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "calendar_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
