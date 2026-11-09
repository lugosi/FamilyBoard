import { NextResponse } from "next/server";
import { fetchPlaceDayForecast } from "@/lib/weather";
import { wmoLabel } from "@/lib/wmo";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const date = url.searchParams.get("date")?.trim() ?? "";
  if (!q || !date) {
    return NextResponse.json(
      { error: "q (location) and date (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const forecast = await fetchPlaceDayForecast({ query: q, date });
    if (!forecast) {
      return NextResponse.json(
        { error: "No forecast for that place and day" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ...forecast,
      label: wmoLabel(forecast.code),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "weather_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
