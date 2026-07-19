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

/** Rain, snow, freezing precip, or thunderstorm WMO codes. */
export function isPrecipOrStormWeatherCode(code: number): boolean {
  return (
    (code >= 51 && code <= 67) ||
    (code >= 71 && code <= 77) ||
    (code >= 80 && code <= 86) ||
    code >= 95
  );
}

/**
 * Open-Meteo daily weather_code is the most severe hour in 24h (incl. overnight),
 * which often looks worse than consumer weather apps. Prefer the dominant daytime
 * condition; keep meaningful daytime precip/storms visible.
 */
export function representativeDaytimeWeatherCode(codes: number[]): number {
  if (codes.length === 0) return 0;

  const wet = codes.filter(isPrecipOrStormWeatherCode);
  if (wet.length >= 2 || wet.some((c) => c >= 95)) {
    return Math.max(...wet);
  }

  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = codes[0]!;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code > best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/** Hour is daytime when between sunrise and sunset (Open-Meteo local ISO strings). */
function isDaytimeForecastHour(
  time: string,
  sunrise?: string,
  sunset?: string,
): boolean {
  if (sunrise && sunset) {
    return time >= sunrise && time < sunset;
  }
  const hour = Number(time.slice(11, 13));
  return Number.isFinite(hour) && hour >= 8 && hour < 18;
}

function daytimeCodesForDate(
  date: string,
  hourlyTimes: string[],
  hourlyCodes: number[],
  sunrise?: string,
  sunset?: string,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < hourlyTimes.length; i++) {
    const time = hourlyTimes[i];
    if (!time?.startsWith(date)) continue;
    if (!isDaytimeForecastHour(time, sunrise, sunset)) continue;
    out.push(hourlyCodes[i] ?? 0);
  }
  return out;
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
  const dailySunrise = data.daily?.sunrise ?? [];
  const dailySunset = data.daily?.sunset ?? [];
  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyTemps = data.hourly?.temperature_2m ?? [];
  const hourlyCodes = data.hourly?.weather_code ?? [];

  const daily = times.map((date, i) => {
    const apiCode = codes[i] ?? 0;
    const daytimeCodes = daytimeCodesForDate(
      date,
      hourlyTimes,
      hourlyCodes,
      dailySunrise[i],
      dailySunset[i],
    );
    return {
      date,
      maxF: max[i] ?? 0,
      minF: min[i] ?? 0,
      code:
        daytimeCodes.length > 0
          ? representativeDaytimeWeatherCode(daytimeCodes)
          : apiCode,
    };
  });

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
