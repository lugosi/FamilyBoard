/** Open-Meteo standard forecast API maximum (days). */
export const WEATHER_FORECAST_DAYS = 16;

export type DailyForecast = {
  date: string;
  maxF: number;
  minF: number;
  code: number;
};

export const HOURLY_FORECAST_HOURS = 18;

export type WeatherSnapshot = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    temperatureF: number;
    humidity: number;
    code: number;
    windMph: number;
  };
  daily: DailyForecast[];
  /** Next 18 clock hours from the current hour (rolling on each refresh). */
  hourlyNext18: Array<{
    time: string;
    temperatureF: number;
    code: number;
  }>;
  /** Today's sunrise/sunset in local forecast timezone (ISO strings). */
  sunriseToday?: string;
  sunsetToday?: string;
  /** Per-day sunrise/sunset for hourly icon night detection. */
  sunByDate: Record<string, SunTimes>;
};

export type SunTimes = {
  sunrise?: string;
  sunset?: string;
};

function localTimeTodayMs(now: Date, hour: number, minute = 0): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function dateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True during night hours for icons/greyscale (not before 10pm; ends by sunrise or 7am). */
export function isNightAt(
  now: Date,
  sunriseToday?: string,
  sunsetToday?: string,
): boolean {
  const t = now.getTime();
  const tenPmMs = localTimeTodayMs(now, 22);
  const sevenAmMs = localTimeTodayMs(now, 7);

  const sunriseMs = sunriseToday ? new Date(sunriseToday).getTime() : NaN;
  const sunsetMs = sunsetToday ? new Date(sunsetToday).getTime() : NaN;
  if (Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs)) {
    const nightStartMs = Math.max(sunsetMs, tenPmMs);
    const nightEndMs = Math.min(sunriseMs, sevenAmMs);
    return t < nightEndMs || t >= nightStartMs;
  }

  const h = now.getHours();
  return h >= 22 || h < 7;
}

/** Night weather icons: after sunset or before sunrise for that calendar day. */
export function isNightForWeatherIcon(
  at: Date,
  sunByDate?: Record<string, SunTimes>,
): boolean {
  const dateKey = dateKeyLocal(at);
  const day = sunByDate?.[dateKey];
  if (day?.sunrise && day?.sunset) {
    const t = at.getTime();
    return t < new Date(day.sunrise).getTime() || t >= new Date(day.sunset).getTime();
  }
  const h = at.getHours();
  return h < 6 || h >= 20;
}

/** Night weather icons from an Open-Meteo hourly timestamp (local forecast time). */
export function isNightForWeatherIconAt(
  timeIso: string,
  sunByDate?: Record<string, SunTimes>,
): boolean {
  const dateKey = timeIso.slice(0, 10);
  const day = sunByDate?.[dateKey];
  if (day?.sunrise && day?.sunset) {
    const t = new Date(timeIso).getTime();
    return t < new Date(day.sunrise).getTime() || t >= new Date(day.sunset).getTime();
  }
  const d = new Date(timeIso);
  const h = d.getHours();
  return h < 6 || h >= 20;
}

/** Greyscale night mode for the board chrome. */
export function isNightGreyscaleActive(
  now: Date,
  sunriseToday?: string,
  sunsetToday?: string,
): boolean {
  return isNightAt(now, sunriseToday, sunsetToday);
}

export function getWeatherCoordinates(): { lat: number; lon: number } | null {
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function fetchOpenMeteo(): Promise<WeatherSnapshot | null> {
  const coords = getWeatherCoordinates();
  if (!coords) return null;

  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
    hourly: "temperature_2m,weather_code",
    timezone: process.env.WEATHER_TIMEZONE?.trim() || "auto",
    forecast_days: String(WEATHER_FORECAST_DAYS),
  });

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    { next: { revalidate: 300 } },
  );
  if (!res.ok) {
    throw new Error(`Weather request failed (${res.status})`);
  }
  const data = (await res.json()) as {
    timezone?: string;
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      sunrise?: string[];
      sunset?: string[];
    };
    hourly?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m?: number[];
    };
  };

  const tz = data.timezone ?? "UTC";
  const cur = data.current;
  if (typeof cur?.temperature_2m !== "number") {
    return null;
  }

  const times = data.daily?.time ?? [];
  const codes = data.daily?.weather_code ?? [];
  const max = data.daily?.temperature_2m_max ?? [];
  const min = data.daily?.temperature_2m_min ?? [];
  const daily = times.map((date, i) => ({
    date,
    maxF: max[i] ?? 0,
    minF: min[i] ?? 0,
    code: codes[i] ?? 0,
  }));

  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyTemps = data.hourly?.temperature_2m ?? [];
  const hourlyCodes = data.hourly?.weather_code ?? [];
  const now = Date.now();
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);
  const startIdx = hourlyTimes.findIndex(
    (t) => new Date(t).getTime() >= currentHourStart.getTime(),
  );
  const fromIdx = startIdx >= 0 ? startIdx : 0;
  const hourlyNext18 = hourlyTimes
    .slice(fromIdx, fromIdx + HOURLY_FORECAST_HOURS)
    .map((time, i) => ({
      time,
      temperatureF: hourlyTemps[fromIdx + i] ?? 0,
      code: hourlyCodes[fromIdx + i] ?? 0,
    }));

  const dailySunrise = data.daily?.sunrise ?? [];
  const dailySunset = data.daily?.sunset ?? [];
  const sunByDate: Record<string, SunTimes> = {};
  for (let i = 0; i < times.length; i++) {
    const date = times[i];
    if (!date) continue;
    sunByDate[date] = {
      sunrise: dailySunrise[i],
      sunset: dailySunset[i],
    };
  }
  const todayDate =
    hourlyTimes.find((t) => new Date(t).getTime() >= now)?.slice(0, 10) ??
    times[0] ??
    "";
  const todayDailyIdx = todayDate ? times.indexOf(todayDate) : 0;
  const dayIdx = todayDailyIdx >= 0 ? todayDailyIdx : 0;

  return {
    latitude: coords.lat,
    longitude: coords.lon,
    timezone: tz,
    current: {
      temperatureF: cur.temperature_2m,
      humidity: cur.relative_humidity_2m ?? 0,
      code: cur.weather_code ?? 0,
      windMph: cur.wind_speed_10m ?? 0,
    },
    daily,
    hourlyNext18,
    sunriseToday: dailySunrise[dayIdx],
    sunsetToday: dailySunset[dayIdx],
    sunByDate,
  };
}

export function dailyForecastByDate(
  daily: DailyForecast[] | undefined,
): Record<string, DailyForecast> {
  const out: Record<string, DailyForecast> = {};
  for (const row of daily ?? []) {
    if (row.date) out[row.date] = row;
  }
  return out;
}
