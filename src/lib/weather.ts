/** Open-Meteo standard forecast API maximum (days). */
export const WEATHER_FORECAST_DAYS = 16;

export type DailyForecast = {
  date: string;
  maxF: number;
  minF: number;
  code: number;
  /** Peak precipitation probability for the day (0–100), when available. */
  precipChance?: number;
};

export const HOURLY_FORECAST_HOURS = 18;
/** Days shown in the board multi-day strip. */
export const DAILY_STRIP_DAYS = 4;

export type WeatherDayPartId = "morning" | "afternoon" | "night";

export type WeatherHourlyPoint = {
  time: string;
  temperatureF: number;
  code: number;
  precipChance?: number;
};

export type WeatherDayPart = {
  id: string;
  part: WeatherDayPartId;
  label: string;
  date: string;
  temperatureF: number;
  code: number;
  precipChance?: number;
  isCurrent: boolean;
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
  /** Next 18 clock hours from the current hour (rolling on each refresh). */
  hourlyNext18: WeatherHourlyPoint[];
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

const DEFAULT_WEATHER_API_BASE = "https://api.open-meteo.com";
const DEFAULT_GEOCODING_API_BASE = "https://geocoding-api.open-meteo.com";
const WEATHER_FETCH_ATTEMPTS = 3;
const WEATHER_FETCH_RETRY_MS = 400;

/** True when CI/local wants canned weather (no Open-Meteo network). */
export function isWeatherFixtureEnabled(): boolean {
  const raw = process.env.WEATHER_FIXTURE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getWeatherApiBase(): string {
  return (process.env.WEATHER_API_BASE_URL?.trim() || DEFAULT_WEATHER_API_BASE).replace(
    /\/+$/,
    "",
  );
}

function getGeocodingApiBase(): string {
  return (
    process.env.WEATHER_GEOCODING_API_BASE_URL?.trim() || DEFAULT_GEOCODING_API_BASE
  ).replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableWeatherStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Fetch with short retries for transient Open-Meteo / network blips. */
async function fetchWeatherUrl(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < WEATHER_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || !isRetryableWeatherStatus(res.status) || attempt === WEATHER_FETCH_ATTEMPTS - 1) {
        return res;
      }
      lastError = new Error(`Weather request failed (${res.status})`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === WEATHER_FETCH_ATTEMPTS - 1) throw lastError;
    }
    await sleep(WEATHER_FETCH_RETRY_MS * 2 ** attempt);
  }
  throw lastError ?? new Error("Weather request failed");
}

/** Deterministic snapshot for CI / offline smoke (WEATHER_FIXTURE=1). */
function fixtureWeatherSnapshot(coords: {
  lat: number;
  lon: number;
}): WeatherSnapshot {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hourIso = (d: Date) =>
    `${dateKey(d)}T${pad(d.getHours())}:00`;

  const daily: DailyForecast[] = [];
  const sunByDate: Record<string, SunTimes> = {};
  for (let i = 0; i < WEATHER_FORECAST_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const date = dateKey(d);
    daily.push({
      date,
      maxF: 68 + (i % 5),
      minF: 52 + (i % 3),
      code: i % 3 === 0 ? 61 : 2,
      precipChance: i % 3 === 0 ? 70 : 10 + (i % 4) * 5,
    });
    sunByDate[date] = {
      sunrise: `${date}T06:45`,
      sunset: `${date}T19:30`,
    };
  }

  const hourlyNext18: WeatherSnapshot["hourlyNext18"] = [];
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  for (let i = 0; i < HOURLY_FORECAST_HOURS; i++) {
    const t = new Date(hourStart);
    t.setHours(t.getHours() + i);
    hourlyNext18.push({
      time: hourIso(t),
      temperatureF: 60 + (i % 8),
      code: i % 4 === 0 ? 3 : 1,
      precipChance: i >= 3 && i <= 6 ? 40 + i * 5 : i % 5 === 0 ? 15 : 0,
    });
  }

  const today = dateKey(now);
  return {
    latitude: coords.lat,
    longitude: coords.lon,
    timezone: process.env.WEATHER_TIMEZONE?.trim() || "America/Los_Angeles",
    current: {
      temperatureF: 64,
      humidity: 55,
      code: 2,
      windMph: 8,
    },
    daily,
    hourlyNext18,
    sunriseToday: sunByDate[today]?.sunrise,
    sunsetToday: sunByDate[today]?.sunset,
    sunByDate,
  };
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

export type GeocodedPlace = {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
};

export type PlaceDayForecast = {
  place: string;
  date: string;
  code: number;
  maxF: number;
  minF: number;
};

const geocodeCache = new Map<string, { at: number; place: GeocodedPlace | null }>();
const GEOCODE_TTL_MS = 6 * 60 * 60 * 1000;

function placeLabel(place: GeocodedPlace): string {
  const bits = [place.name, place.admin1, place.country].filter(Boolean);
  // Prefer "City, State" when both exist; drop redundant country for US homes.
  if (place.name && place.admin1) return `${place.name}, ${place.admin1}`;
  return bits[0] ?? place.name;
}

/** Open-Meteo geocoding (no API key). Tries the full query, then trailing fragments. */
export async function geocodeOpenMeteo(query: string): Promise<GeocodedPlace | null> {
  const raw = query.trim().replace(/\s+/g, " ");
  if (!raw) return null;
  const cacheKey = raw.toLowerCase();
  const hit = geocodeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < GEOCODE_TTL_MS) return hit.place;

  const attempts = [raw];
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) attempts.push(parts.slice(-2).join(", "));
  if (parts.length >= 1) attempts.push(parts[parts.length - 1]!);

  let place: GeocodedPlace | null = null;
  for (const name of attempts) {
    const params = new URLSearchParams({
      name,
      count: "1",
      language: "en",
      format: "json",
    });
    let res: Response;
    try {
      res = await fetchWeatherUrl(
        `${getGeocodingApiBase()}/v1/search?${params.toString()}`,
        { next: { revalidate: 3600 } },
      );
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = (await res.json()) as {
      results?: Array<{
        name?: string;
        latitude?: number;
        longitude?: number;
        admin1?: string;
        country?: string;
      }>;
    };
    const row = data.results?.[0];
    if (
      row?.name &&
      typeof row.latitude === "number" &&
      typeof row.longitude === "number"
    ) {
      place = {
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        admin1: row.admin1,
        country: row.country,
      };
      break;
    }
  }

  geocodeCache.set(cacheKey, { at: Date.now(), place });
  return place;
}

export async function fetchOpenMeteoAt(
  coords: { lat: number; lon: number },
  opts?: { forecastDays?: number },
): Promise<WeatherSnapshot | null> {
  if (isWeatherFixtureEnabled()) {
    return fixtureWeatherSnapshot(coords);
  }

  const forecastDays = opts?.forecastDays ?? WEATHER_FORECAST_DAYS;
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
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    timezone: process.env.WEATHER_TIMEZONE?.trim() || "auto",
    forecast_days: String(forecastDays),
  });

  const res = await fetchWeatherUrl(
    `${getWeatherApiBase()}/v1/forecast?${params.toString()}`,
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
      precipitation_probability_max?: number[];
      sunrise?: string[];
      sunset?: string[];
    };
    hourly?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
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
  const precipMax = data.daily?.precipitation_probability_max ?? [];
  const dailySunrise = data.daily?.sunrise ?? [];
  const dailySunset = data.daily?.sunset ?? [];
  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyTemps = data.hourly?.temperature_2m ?? [];
  const hourlyCodes = data.hourly?.weather_code ?? [];
  const hourlyPrecip = data.hourly?.precipitation_probability ?? [];

  const daily = times.map((date, i) => {
    const apiCode = codes[i] ?? 0;
    const daytimeCodes = daytimeCodesForDate(
      date,
      hourlyTimes,
      hourlyCodes,
      dailySunrise[i],
      dailySunset[i],
    );
    const precipRaw = precipMax[i];
    return {
      date,
      maxF: max[i] ?? 0,
      minF: min[i] ?? 0,
      code:
        daytimeCodes.length > 0
          ? representativeDaytimeWeatherCode(daytimeCodes)
          : apiCode,
      precipChance:
        typeof precipRaw === "number" && Number.isFinite(precipRaw)
          ? Math.round(precipRaw)
          : undefined,
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
    .map((time, i) => {
      const precipRaw = hourlyPrecip[fromIdx + i];
      return {
        time,
        temperatureF: hourlyTemps[fromIdx + i] ?? 0,
        code: hourlyCodes[fromIdx + i] ?? 0,
        precipChance:
          typeof precipRaw === "number" && Number.isFinite(precipRaw)
            ? Math.round(precipRaw)
            : undefined,
      };
    });

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

export async function fetchOpenMeteo(): Promise<WeatherSnapshot | null> {
  const coords = getWeatherCoordinates();
  if (!coords) return null;
  return fetchOpenMeteoAt(coords);
}

export type PlaceForecastRange = {
  place: string;
  days: PlaceDayForecast[];
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Day forecast for a calendar location string (geocode → Open-Meteo daily). */
export async function fetchPlaceDayForecast(input: {
  query: string;
  date: string;
}): Promise<PlaceDayForecast | null> {
  const range = await fetchPlaceForecastRange({
    query: input.query,
    from: input.date,
    to: input.date,
  });
  return range?.days[0] ?? null;
}

/** Inclusive from/to day forecasts for a place (missing days omitted). */
export async function fetchPlaceForecastRange(input: {
  query: string;
  from: string;
  to: string;
}): Promise<PlaceForecastRange | null> {
  if (!DATE_KEY_RE.test(input.from) || !DATE_KEY_RE.test(input.to)) return null;
  const from = input.from <= input.to ? input.from : input.to;
  const to = input.from <= input.to ? input.to : input.from;
  const place = await geocodeOpenMeteo(input.query);
  if (!place) return null;

  // Open-Meteo forecast window is ~16 days from today; past dates may be missing.
  const snapshot = await fetchOpenMeteoAt(
    { lat: place.latitude, lon: place.longitude },
    { forecastDays: WEATHER_FORECAST_DAYS },
  );
  if (!snapshot) return null;

  const days = snapshot.daily.filter((d) => d.date >= from && d.date <= to);
  if (!days.length) return null;

  return {
    place: placeLabel(place),
    days: days.map((d) => ({
      place: placeLabel(place),
      date: d.date,
      code: d.code,
      maxF: d.maxF,
      minF: d.minF,
    })),
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

const DAY_PART_META: Record<
  WeatherDayPartId,
  { label: string; startHour: number; endHour: number }
> = {
  morning: { label: "Morning", startHour: 6, endHour: 12 },
  afternoon: { label: "Afternoon", startHour: 12, endHour: 18 },
  night: { label: "Night", startHour: 18, endHour: 24 },
};

function dayPartForHour(hour: number): WeatherDayPartId {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "night";
}

/** Night 0–5 belongs with the previous calendar evening. */
function dayPartAnchorDate(timeIso: string): { date: string; part: WeatherDayPartId } {
  const hour = Number(timeIso.slice(11, 13));
  const part = dayPartForHour(Number.isFinite(hour) ? hour : 12);
  if (part === "night" && Number.isFinite(hour) && hour < 6) {
    const d = new Date(`${timeIso.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return { date: `${y}-${m}-${day}`, part };
    }
  }
  return { date: timeIso.slice(0, 10), part };
}

function currentDayPart(now: Date): { date: string; part: WeatherDayPartId } {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = now.getHours();
  const part = dayPartForHour(hour);
  if (part === "night" && hour < 6) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const py = d.getFullYear();
    const pm = String(d.getMonth() + 1).padStart(2, "0");
    const pd = String(d.getDate()).padStart(2, "0");
    return { date: `${py}-${pm}-${pd}`, part };
  }
  return { date: `${y}-${m}-${day}`, part };
}

/**
 * Collapse hourly points into Morning / Afternoon / Night blocks.
 * Returns upcoming parts (current first), typically 3 for the board widget.
 */
export function summarizeWeatherDayParts(
  hours: WeatherHourlyPoint[] | undefined,
  now: Date = new Date(),
  limit = 3,
): WeatherDayPart[] {
  if (!hours?.length) return [];

  type Agg = {
    date: string;
    part: WeatherDayPartId;
    temps: number[];
    codes: number[];
    precip: number[];
  };
  const order: string[] = [];
  const byKey = new Map<string, Agg>();

  for (const h of hours) {
    if (!h.time || !Number.isFinite(h.temperatureF)) continue;
    const { date, part } = dayPartAnchorDate(h.time);
    const key = `${date}:${part}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { date, part, temps: [], codes: [], precip: [] };
      byKey.set(key, agg);
      order.push(key);
    }
    agg.temps.push(h.temperatureF);
    agg.codes.push(h.code);
    if (typeof h.precipChance === "number" && Number.isFinite(h.precipChance)) {
      agg.precip.push(h.precipChance);
    }
  }

  const current = currentDayPart(now);
  const currentKey = `${current.date}:${current.part}`;
  const startIdx = Math.max(
    0,
    order.findIndex((k) => k === currentKey || k > currentKey),
  );

  const parts: WeatherDayPart[] = [];
  for (const key of order.slice(startIdx)) {
    const agg = byKey.get(key);
    if (!agg || agg.temps.length === 0) continue;
    const meta = DAY_PART_META[agg.part];
    const temperatureF =
      agg.part === "night"
        ? Math.min(...agg.temps)
        : Math.max(...agg.temps);
    const wetCodes = agg.codes.filter(isPrecipOrStormWeatherCode);
    const precipChance = agg.precip.length ? Math.max(...agg.precip) : undefined;
    parts.push({
      id: key,
      part: agg.part,
      label: meta.label,
      date: agg.date,
      temperatureF,
      // Prefer precip/storm icons when the block has wet hours (or high rain %).
      code:
        wetCodes.length > 0 || (precipChance != null && precipChance >= 40)
          ? Math.max(...(wetCodes.length ? wetCodes : agg.codes))
          : representativeDaytimeWeatherCode(agg.codes),
      precipChance,
      isCurrent: key === currentKey,
    });
    if (parts.length >= limit) break;
  }
  return parts;
}
