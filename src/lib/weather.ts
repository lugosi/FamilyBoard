export type WeatherSnapshot = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    temperatureC: number;
    humidity: number;
    code: number;
    windKmh: number;
  };
  daily: Array<{
    date: string;
    maxC: number;
    minC: number;
    code: number;
  }>;
  hourlyToday: Array<{
    time: string;
    temperatureC: number;
    code: number;
  }>;
};

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
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    hourly: "temperature_2m,weather_code",
    timezone: process.env.WEATHER_TIMEZONE?.trim() || "auto",
    forecast_days: "5",
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
    maxC: max[i] ?? 0,
    minC: min[i] ?? 0,
    code: codes[i] ?? 0,
  }));

  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyTemps = data.hourly?.temperature_2m ?? [];
  const hourlyCodes = data.hourly?.weather_code ?? [];
  const now = Date.now();
  const hourlyToday = hourlyTimes
    .map((time, i) => ({
      time,
      temperatureC: hourlyTemps[i] ?? 0,
      code: hourlyCodes[i] ?? 0,
      ts: new Date(time).getTime(),
    }))
    .filter((h) => Number.isFinite(h.ts) && h.ts >= now - 60 * 60 * 1000)
    .slice(0, 12)
    .map(({ time, temperatureC, code }) => ({ time, temperatureC, code }));

  return {
    latitude: coords.lat,
    longitude: coords.lon,
    timezone: tz,
    current: {
      temperatureC: cur.temperature_2m,
      humidity: cur.relative_humidity_2m ?? 0,
      code: cur.weather_code ?? 0,
      windKmh: cur.wind_speed_10m ?? 0,
    },
    daily,
    hourlyToday,
  };
}
