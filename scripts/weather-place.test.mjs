import test from "node:test";
import assert from "node:assert/strict";
import {
  geocodeOpenMeteo,
  fetchPlaceDayForecast,
  fetchPlaceForecastRange,
} from "../src/lib/weather.ts";

test("geocodeOpenMeteo finds a known city", async () => {
  const place = await geocodeOpenMeteo("Berkeley, California");
  assert.ok(place, "expected a geocode hit");
  assert.match(place.name, /Berkeley/i);
  assert.ok(Number.isFinite(place.latitude));
  assert.ok(Number.isFinite(place.longitude));
});

test("fetchPlaceDayForecast returns day high/low for a place", async () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const date = `${y}-${m}-${d}`;
  const forecast = await fetchPlaceDayForecast({
    query: "Berkeley, CA",
    date,
  });
  assert.ok(forecast, "expected a day forecast");
  assert.equal(forecast.date, date);
  assert.ok(Number.isFinite(forecast.maxF));
  assert.ok(Number.isFinite(forecast.minF));
  assert.ok(forecast.maxF >= forecast.minF);
  assert.ok(typeof forecast.code === "number");
  assert.match(forecast.place, /Berkeley/i);
});

test("fetchPlaceDayForecast rejects bad dates", async () => {
  const forecast = await fetchPlaceDayForecast({
    query: "Berkeley, CA",
    date: "not-a-date",
  });
  assert.equal(forecast, null);
});

test("fetchPlaceForecastRange returns multiple days", async () => {
  const today = new Date();
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const from = fmt(today);
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 2);
  const to = fmt(toDate);
  const range = await fetchPlaceForecastRange({
    query: "Berkeley, CA",
    from,
    to,
  });
  assert.ok(range, "expected a range");
  assert.ok(range.days.length >= 1);
  assert.ok(range.days.length <= 3);
  assert.equal(range.days[0].date, from);
  assert.match(range.place, /Berkeley/i);
});
