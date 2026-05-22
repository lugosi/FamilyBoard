/** Open-Meteo standard forecast API maximum (days). */
export const WEATHER_FORECAST_DAYS = 16;

export type DailyForecast = {
  date: string;
  maxF: number;
  minF: number;
  code: number;
};

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
  /** Next 12 clock hours from the current hour (rolling on each refresh). */
  hourlyNext12: Array<{
    time: string;
    temperatureF: number;
    code: number;
  }>;
  /** Today's sunrise/sunset in local forecast timezone (ISO strings). */
  sunriseToday?: string;
  sunsetToday?: string;
};

/** Greyscale night mode: from sunset until sunrise (fallback: 10pm–7am local). */
export function isNightGreyscaleActive(
  now: Date,
  sunriseToday?: string,
  sunsetToday?: string,
): boolean {
  const sunriseMs = sunriseToday ? new Date(sunriseToday).getTime() : NaN;
  const sunsetMs = sunsetToday ? new Date(sunsetToday).getTime() : NaN;
  if (Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs)) {
    const t = now.getTime();
    return t < sunriseMs || t >= sunsetMs;
  }
  const h = now.getHours();
  return h >= 22 || h < 7;
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
  const hourlyNext12 = hourlyTimes
    .slice(fromIdx, fromIdx + 12)
    .map((time, i) => ({
      time,
      temperatureF: hourlyTemps[fromIdx + i] ?? 0,
      code: hourlyCodes[fromIdx + i] ?? 0,
    }));

  const dailySunrise = data.daily?.sunrise ?? [];
  const dailySunset = data.daily?.sunset ?? [];
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
    hourlyNext12,
    sunriseToday: dailySunrise[dayIdx],
    sunsetToday: dailySunset[dayIdx],
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
