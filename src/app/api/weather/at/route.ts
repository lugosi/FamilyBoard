import { NextResponse } from "next/server";
import { fetchPlaceDayForecast, fetchPlaceForecastRange } from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const date = url.searchParams.get("date")?.trim() ?? "";
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "q (location) is required" }, { status: 400 });
  }

  const rangeFrom = from || date;
  const rangeTo = to || date;
  if (!rangeFrom || !rangeTo) {
    return NextResponse.json(
      { error: "Provide date=YYYY-MM-DD, or from= and to= (inclusive)" },
      { status: 400 },
    );
  }
  if (!DATE_KEY_RE.test(rangeFrom) || !DATE_KEY_RE.test(rangeTo)) {
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    if (rangeFrom === rangeTo) {
      const forecast = await fetchPlaceDayForecast({ query: q, date: rangeFrom });
      if (!forecast) {
        return NextResponse.json(
          { error: "No forecast for that place and day" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ...forecast,
        label: wmoLabel(forecast.code),
        days: [{ ...forecast, label: wmoLabel(forecast.code) }],
      });
    }

    const range = await fetchPlaceForecastRange({
      query: q,
      from: rangeFrom,
      to: rangeTo,
    });
    if (!range) {
      return NextResponse.json(
        { error: "No forecast for that place and range" },
        { status: 404 },
      );
    }
    const days = range.days.map((d) => ({
      ...d,
      label: wmoLabel(d.code),
    }));
    return NextResponse.json({
      place: range.place,
      from: rangeFrom,
      to: rangeTo,
      days,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "weather_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
