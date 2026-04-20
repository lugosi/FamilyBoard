import { NextResponse } from "next/server";
import { fetchOpenMeteo, getWeatherCoordinates } from "@/lib/weather";

export async function GET() {
  if (!getWeatherCoordinates()) {
    return NextResponse.json(
      { error: "Set WEATHER_LAT and WEATHER_LON" },
      { status: 501 },
    );
  }
  try {
    const snapshot = await fetchOpenMeteo();
    if (!snapshot) {
      return NextResponse.json({ error: "Weather unavailable" }, { status: 502 });
    }
    return NextResponse.json(snapshot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "weather_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
