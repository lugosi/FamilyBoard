"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CompactCalendarGrid } from "@/components/calendar/CompactCalendarGrid";
import { EventDateTimePicker } from "@/components/calendar/EventDateTimePicker";
import {
  addDays,
  dateKeyLocal,
  DEFAULT_HOME_CALENDAR_WEEKS,
  defaultCalendarRangeKeys,
  enumerateWeekStarts,
  eventBarClass,
  eventOverlapsLocalDay,
  getEventBounds,
  parseLocalDateKey,
  rangeKeysToIso,
  shiftCalendarRangeByMonth,
  startOfDay,
  type CalendarRangeKeys,
  type GEvent,
} from "@/lib/calendar-layout";
import { OnekoCat } from "@/components/OnekoCat";
import {
  WeatherHourlyChart,
  type WeatherHourlyPoint,
} from "@/components/WeatherHourlyChart";
import { WeatherIcon } from "@/components/WeatherIcon";
import {
  dailyForecastByDate,
  isNightGreyscaleActive,
  type DailyForecast,
} from "@/lib/weather";
import { IndoorClimateCharts } from "@/components/IndoorClimateCharts";
import type { ClimateHistorySample } from "@/lib/nest-climate-history";

type HueArea = {
  id: string;
  name: string;
  on: boolean;
  type: string;
};

type Status = {
  googleLinked: boolean;
  googleConfigured: boolean;
  nestConfigured?: boolean;
  spotifyLinked: boolean;
  spotifyConfigured: boolean;
  hueReady: boolean;
  hueBridgeIp: string | null;
  huePaired: boolean;
  weatherConfigured: boolean;
  catlinkConfigured?: boolean;
  catlinkLinked?: boolean;
};

type CalendarOption = {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
  accessRole: string;
  backgroundColor: string | null;
};

type CalendarEvent = GEvent & {
  sourceCalendarId?: string;
  sourceCalendarSummary?: string;
  sourceCalendarColor?: string | null;
};

type IndoorClimate = {
  temperatureF?: number | null;
  humidity?: number | null;
  deviceName?: string | null;
  hasData?: boolean;
  error?: string;
  history?: ClimateHistorySample[];
};

type SpotifyDevice = {
  id?: string;
  is_active?: boolean;
  is_restricted?: boolean;
  name?: string;
  type?: string;
  volume_percent?: number;
};

type SpotifyPlayback = {
  is_playing?: boolean;
  progress_ms?: number;
  item?: {
    id?: string;
    name?: string;
    duration_ms?: number;
    album?: { name?: string; images?: Array<{ url?: string }> };
    artists?: Array<{ name?: string }>;
  };
  device?: SpotifyDevice;
};

type SpotifySearchTrack = {
  id?: string;
  name?: string;
  uri?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
};

type SpotifySearchAlbum = {
  id?: string;
  name?: string;
  uri?: string;
  artists?: Array<{ name?: string }>;
  images?: Array<{ url?: string }>;
};

type SpotifySearchPlaylist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: Array<{ url?: string }>;
  owner?: { display_name?: string };
};
type HueThemeKey = "bright" | "relax" | "focus" | "nightlight";
type CatlinkAction = "clean_now" | "refill_litter" | "change_bag" | "reset_bin";
type CatlinkSnapshot = {
  online?: boolean;
  catName?: string;
  catWeightKg?: number;
  peeCountToday?: number;
  poopCountToday?: number;
  updatedAt?: string;
  [key: string]: unknown;
};
type SpotifyRecentItem = {
  kind: "track" | "album" | "playlist";
  id: string;
  name: string;
  subtitle: string;
  imageUrl?: string;
  uri?: string;
  addedAt: number;
};

const HUE_PINNED_ORDER = ["tv", "living room", "caro", "office"] as const;
const HUE_THEME_OPTIONS: Array<{ key: HueThemeKey; label: string }> = [
  { key: "bright", label: "Bright" },
  { key: "relax", label: "Relax" },
  { key: "focus", label: "Focus" },
  { key: "nightlight", label: "Nightlight" },
];

type RightWidgetKey = "clock" | "weather" | "catlink" | "nest" | "hue" | "spotify";
type SpotifyResultTab = "recent" | "featured" | "results";

type SpotifyWebPlaybackPlayer = {
  addListener: (event: string, cb: (arg: unknown) => void) => boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement?: () => Promise<void>;
};

type SpotifyWebPlaybackSDK = {
  Player: new (config: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyWebPlaybackPlayer;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: SpotifyWebPlaybackSDK;
  }
}

function formatMsClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const WIDGET_TITLE_ICON = "h-8 w-8 shrink-0 sm:h-9 sm:w-9";

const HUE_BULB_PATH =
  "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z";

function HueBulbTitleIcon({ on }: { on: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`${WIDGET_TITLE_ICON} ${
        on
          ? "text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.55)]"
          : "text-slate-400"
      }`}
      fill={on ? "currentColor" : "none"}
      fillOpacity={on ? 0.3 : 0}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={HUE_BULB_PATH} />
    </svg>
  );
}

function SpotifyAlbumTitleIcon({ coverUrl }: { coverUrl?: string }) {
  if (coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverUrl}
        alt=""
        className={`${WIDGET_TITLE_ICON} rounded object-cover shadow-sm ring-1 ring-slate-700/80`}
      />
    );
  }
  return (
    <div
      className={`${WIDGET_TITLE_ICON} flex items-center justify-center rounded bg-slate-800 text-slate-500 ring-1 ring-slate-700/80`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function IndoorTempTitleIcon({ tempF }: { tempF: number | null }) {
  const label =
    tempF !== null && Number.isFinite(tempF) ? `${Math.round(tempF)}°` : "—";
  return (
    <span
      className={`${WIDGET_TITLE_ICON} flex items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 text-sm font-semibold tabular-nums text-white ring-1 ring-slate-700/80 sm:text-base`}
      title={tempF !== null ? `Indoor ${Math.round(tempF)}°F` : "Indoor temperature"}
    >
      {label}
    </span>
  );
}

function ClockTimeTitleIcon({ time }: { time: string }) {
  return (
    <span
      className="flex h-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 px-2 text-xs font-semibold leading-none whitespace-nowrap tabular-nums text-white ring-1 ring-slate-700/80 sm:h-9 sm:px-2.5 sm:text-sm"
      title={time}
    >
      {time}
    </span>
  );
}

function toInputValue(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialNewEventRange(forDay?: Date) {
  const dayKey = dateKeyLocal(forDay ?? new Date());
  if (dayKey === dateKeyLocal(new Date())) {
    const s = new Date();
    s.setMinutes(Math.ceil(s.getMinutes() / 15) * 15, 0, 0);
    const e = new Date(s.getTime() + 60 * 60 * 1000);
    return { start: toInputValue(s.toISOString()), end: toInputValue(e.toISOString()) };
  }
  return {
    start: dateKeyToDatetimeLocal(dayKey, 9, 0),
    end: dateKeyToDatetimeLocal(dayKey, 10, 0),
  };
}

/** Google Calendar all-day `end.date` is exclusive; form uses inclusive last day. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function inclusiveLastDayFromGoogleAllDayEnd(exclusiveEndDate: string): string {
  return dateKeyLocal(addDays(parseLocalDateKey(exclusiveEndDate), -1));
}

function dateKeyToDatetimeLocal(key: string, hour: number, minute: number): string {
  const d = parseLocalDateKey(key);
  d.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

/** Prefer a calendar named "Berkeley" when picking a default from the list. */
function pickDefaultCalendarId(options: CalendarOption[]): string {
  if (options.length === 0) return "primary";
  const berkeley = options.find(
    (c) => c.summary.trim().toLowerCase() === "berkeley",
  );
  if (berkeley) return berkeley.id;
  return (
    options.find((c) => c.primary)?.id ??
    options.find((c) => c.selected)?.id ??
    options[0]!.id
  );
}

const SESSION_EXPLICIT_CALENDAR = "familyboard_explicit_calendar";
const SPOTIFY_KNOWN_DEVICES_KEY = "familyboard_spotify_known_devices";
const SPOTIFY_RECENT_ITEMS_KEY = "familyboard_spotify_recent_items";
const SPOTIFY_VOLUME_STEP = 5;

function mergeSpotifyDevices(
  primary: SpotifyDevice[],
  secondary: SpotifyDevice[],
): SpotifyDevice[] {
  const byName = new Map<string, SpotifyDevice>();
  const byId = new Map<string, SpotifyDevice>();
  for (const d of [...primary, ...secondary]) {
    const id = (d.id ?? "").trim();
    const name = (d.name ?? "").trim().toLowerCase();
    if (name) {
      const existing = byName.get(name);
      if (!existing || (!existing.is_active && Boolean(d.is_active))) {
        byName.set(name, d);
      }
      continue;
    }
    if (id && !byId.has(id)) {
      byId.set(id, d);
    }
  }
  return [...byName.values(), ...byId.values()];
}

function markCalendarExplicitlyChosen() {
  try {
    sessionStorage.setItem(SESSION_EXPLICIT_CALENDAR, "1");
  } catch {
    /* ignore */
  }
}

function userChoseCalendarExplicitly(): boolean {
  try {
    return sessionStorage.getItem(SESSION_EXPLICIT_CALENDAR) === "1";
  } catch {
    return false;
  }
}

function clearCalendarExplicitChoice() {
  try {
    sessionStorage.removeItem(SESSION_EXPLICIT_CALENDAR);
  } catch {
    /* ignore */
  }
}

export function Board() {
  const search = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [areas, setAreas] = useState<HueArea[]>([]);
  const [hueAnyLightOn, setHueAnyLightOn] = useState(false);
  const [weather, setWeather] = useState<Record<string, unknown> | null>(null);
  const [catlink, setCatlink] = useState<CatlinkSnapshot | null>(null);
  const [catlinkLinkPhone, setCatlinkLinkPhone] = useState("");
  const [catlinkLinkPassword, setCatlinkLinkPassword] = useState("");
  const [indoorClimate, setIndoorClimate] = useState<IndoorClimate | null>(null);
  const [spotifyPlayback, setSpotifyPlayback] = useState<SpotifyPlayback | null>(
    null,
  );
  const [spotifyDevices, setSpotifyDevices] = useState<SpotifyDevice[]>([]);
  const [spotifyKnownDevices, setSpotifyKnownDevices] = useState<SpotifyDevice[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = localStorage.getItem(SPOTIFY_KNOWN_DEVICES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SpotifyDevice[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [spotifySeekDraft, setSpotifySeekDraft] = useState<number | null>(null);
  const [spotifyVolumePending, setSpotifyVolumePending] = useState<number | null>(null);
  const [spotifyProgressAnchorMs, setSpotifyProgressAnchorMs] = useState(0);
  const [spotifyProgressAnchorAtMs, setSpotifyProgressAnchorAtMs] = useState(
    () => Date.now(),
  );
  const [spotifyProgressNowMs, setSpotifyProgressNowMs] = useState(() => Date.now());
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [spotifySearchResults, setSpotifySearchResults] = useState<{
    tracks: SpotifySearchTrack[];
    albums: SpotifySearchAlbum[];
    playlists: SpotifySearchPlaylist[];
  }>({ tracks: [], albums: [], playlists: [] });
  const [spotifyResultTab, setSpotifyResultTab] = useState<SpotifyResultTab>("recent");
  const [spotifyRecentItems, setSpotifyRecentItems] = useState<SpotifyRecentItem[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = localStorage.getItem(SPOTIFY_RECENT_ITEMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SpotifyRecentItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [spotifyRecentSource, setSpotifyRecentSource] = useState<"local" | "account">("local");
  const [spotifyRecentError, setSpotifyRecentError] = useState<string | null>(null);
  const [spotifyFeaturedPlaylists, setSpotifyFeaturedPlaylists] = useState<SpotifySearchPlaylist[]>(
    [],
  );
  const [spotifyFeaturedLoading, setSpotifyFeaturedLoading] = useState(false);
  const [spotifyFeaturedError, setSpotifyFeaturedError] = useState<string | null>(null);
  const [spotifyPickOpen, setSpotifyPickOpen] = useState(false);
  const spotifyPickInputRef = useRef<HTMLInputElement | null>(null);
  const spotifySearchSeq = useRef(0);
  const [spotifySdkReady, setSpotifySdkReady] = useState(false);
  const [spotifySdkDeviceId, setSpotifySdkDeviceId] = useState<string | null>(null);
  const [spotifySelectedDeviceId, setSpotifySelectedDeviceId] = useState<string>("");
  const [spotifyNotice, setSpotifyNotice] = useState<string | null>(null);
  const spotifyPlayerRef = useRef<SpotifyWebPlaybackPlayer | null>(null);
  /** Last active Connect device id from `/me/player` polls; used to refresh device list when output moves. */
  const spotifyPollDeviceIdRef = useRef<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newSummary, setNewSummary] = useState("");
  const [newTimes, setNewTimes] = useState(() => initialNewEventRange());
  const [newAllDay, setNewAllDay] = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);

  const [editOpen, setEditOpen] = useState<GEvent | null>(null);
  const [editAllDay, setEditAllDay] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const [rangeKeys, setRangeKeys] = useState<CalendarRangeKeys>(() =>
    defaultCalendarRangeKeys(DEFAULT_HOME_CALENDAR_WEEKS),
  );
  const fetchIso = useMemo(() => rangeKeysToIso(rangeKeys), [rangeKeys]);
  const weekStarts = useMemo(() => {
    const a = startOfDay(parseLocalDateKey(rangeKeys.fromKey));
    const b = startOfDay(parseLocalDateKey(rangeKeys.toInclusiveKey));
    return enumerateWeekStarts(a, b);
  }, [rangeKeys.fromKey, rangeKeys.toInclusiveKey]);

  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("primary");

  const [clockNow, setClockNow] = useState(() => new Date());
  const [showOtherHueAreas, setShowOtherHueAreas] = useState(false);
  const [hueThemeByArea, setHueThemeByArea] = useState<Record<string, HueThemeKey>>({});
  const [collapsedWidgets, setCollapsedWidgets] = useState<
    Record<RightWidgetKey, boolean>
  >({
    clock: false,
    weather: false,
    catlink: false,
    nest: false,
    hue: false,
    spotify: false,
  });

  const sunriseToday =
    typeof weather?.sunriseToday === "string" ? weather.sunriseToday : undefined;
  const sunsetToday =
    typeof weather?.sunsetToday === "string" ? weather.sunsetToday : undefined;

  const [nightGreyscale, setNightGreyscale] = useState(false);
  useEffect(() => {
    function tickNight() {
      setNightGreyscale(
        isNightGreyscaleActive(new Date(), sunriseToday, sunsetToday),
      );
    }
    tickNight();
    const nid = window.setInterval(tickNight, 60_000);
    return () => window.clearInterval(nid);
  }, [sunriseToday, sunsetToday]);

  useEffect(() => {
    const id = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function toggleWidgetCollapse(key: RightWidgetKey) {
    setCollapsedWidgets((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const urlBanner = useMemo(() => {
    const err = search.get("google_error");
    if (err) return `Google: ${err}`;
    if (search.get("google") === "linked") return "Google Calendar linked.";
    const nestPcmErr = search.get("nest_pcm_error");
    if (nestPcmErr) return `Nest authorize: ${nestPcmErr}`;
    if (search.get("nest_pcm") === "linked") {
      return "Nest home/devices authorized — indoor climate should update shortly.";
    }
    const spotifyErr = search.get("spotify_error");
    if (spotifyErr) return `Spotify: ${spotifyErr}`;
    if (search.get("spotify") === "linked") return "Spotify linked.";
    return null;
  }, [search]);

  const alertText = message ?? urlBanner;
  /** Exact text of the last dismissed alert; cleared when there is no alert. */
  const [dismissedAlertSignature, setDismissedAlertSignature] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (alertText !== null) return;
    queueMicrotask(() => {
      setDismissedAlertSignature(null);
    });
  }, [alertText]);
  const showBanner =
    Boolean(alertText) && alertText !== dismissedAlertSignature;
  const calendarComfortable = !showBanner;

  function dismissAlertBanner() {
    if (alertText) setDismissedAlertSignature(alertText);
  }

  useEffect(() => {
    if (alertText == null || alertText === dismissedAlertSignature) return;
    const id = window.setTimeout(() => {
      setDismissedAlertSignature(alertText);
    }, 5000);
    return () => window.clearTimeout(id);
  }, [alertText, dismissedAlertSignature]);

  const fetchSpotifyDevices = useCallback(
    async (signal?: AbortSignal): Promise<SpotifyDevice[] | null> => {
      const dRes = await fetch("/api/spotify/devices", { signal });
      if (signal?.aborted) return null;
      if (dRes.status === 401) {
        setSpotifyDevices([]);
        return [];
      }
      if (!dRes.ok) return null;
      const data = (await dRes.json()) as { devices?: SpotifyDevice[] };
      const devices = data.devices ?? [];
      setSpotifyDevices(devices);
      setSpotifyKnownDevices((prev) => {
        const map = new Map<string, SpotifyDevice>();
        for (const d of prev) {
          if (d.id) map.set(d.id, d);
        }
        for (const d of devices) {
          if (d.id) map.set(d.id, d);
        }
        return Array.from(map.values());
      });
      return devices;
    },
    [],
  );

  const fetchBoard = useCallback(
    async (signal?: AbortSignal) => {
      const sRes = await fetch("/api/auth/status", { signal });
      if (!sRes.ok) return;
      const s = (await sRes.json()) as Status;
      if (signal?.aborted) return;
      setStatus(s);

      if (s.googleLinked) {
        let activeCalendarId = selectedCalendarId;
        const listRes = await fetch("/api/calendar/calendars", { signal });
        if (signal?.aborted) return;
        if (listRes.ok) {
          const listData = (await listRes.json()) as { calendars: CalendarOption[] };
          const options = listData.calendars ?? [];
          setCalendars(options);
          const stillExists =
            selectedCalendarId === "__all__" ||
            options.some((c) => c.id === selectedCalendarId);
          if (!stillExists) {
            const preferred = pickDefaultCalendarId(options);
            activeCalendarId = preferred;
            setSelectedCalendarId(preferred);
          } else if (!userChoseCalendarExplicitly()) {
            const berkeleyCal = options.find(
              (c) => c.summary.trim().toLowerCase() === "berkeley",
            );
            if (berkeleyCal && selectedCalendarId !== berkeleyCal.id) {
              const primaryCal = options.find((c) => c.primary);
              const onGenericPrimary =
                selectedCalendarId === "primary" ||
                Boolean(primaryCal && selectedCalendarId === primaryCal.id);
              if (onGenericPrimary) {
                activeCalendarId = berkeleyCal.id;
                setSelectedCalendarId(berkeleyCal.id);
              }
            }
          }
        }

        const cRes = await fetch(
          `/api/calendar/events?from=${encodeURIComponent(fetchIso.from)}&to=${encodeURIComponent(fetchIso.to)}&calendarId=${encodeURIComponent(activeCalendarId)}`,
          { signal },
        );
        if (signal?.aborted) return;
        if (cRes.status === 401) {
          setEvents([]);
        } else if (cRes.ok) {
          const data = (await cRes.json()) as { events: CalendarEvent[] };
          setEvents(data.events ?? []);
        }
        const todayFrom = new Date();
        todayFrom.setHours(0, 0, 0, 0);
        const todayTo = new Date(todayFrom);
        todayTo.setDate(todayTo.getDate() + 1);
        const tRes = await fetch(
          `/api/calendar/events?from=${encodeURIComponent(todayFrom.toISOString())}&to=${encodeURIComponent(todayTo.toISOString())}&calendarId=${encodeURIComponent(activeCalendarId)}`,
          { signal },
        );
        if (signal?.aborted) return;
        if (tRes.status === 401) {
          setTodayEvents([]);
        } else if (tRes.ok) {
          const data = (await tRes.json()) as { events: CalendarEvent[] };
          setTodayEvents(data.events ?? []);
        }
      } else {
        setCalendars([]);
        setSelectedCalendarId("primary");
        clearCalendarExplicitChoice();
        setEvents([]);
        setTodayEvents([]);
      }

      if (s.hueReady) {
        const [hRes, lRes] = await Promise.all([
          fetch("/api/hue/areas", { signal }),
          fetch("/api/hue/lights", { signal }),
        ]);
        if (signal?.aborted) return;
        if (hRes.status === 501) {
          setAreas([]);
        } else if (hRes.ok) {
          const data = (await hRes.json()) as { areas: HueArea[] };
          setAreas(data.areas ?? []);
        }
        if (lRes.ok) {
          const lightData = (await lRes.json()) as {
            lights?: { on?: boolean; reachable?: boolean }[];
          };
          setHueAnyLightOn(
            lightData.lights?.some((l) => l.on && l.reachable !== false) ?? false,
          );
        } else {
          setHueAnyLightOn(false);
        }
      } else {
        setAreas([]);
        setHueAnyLightOn(false);
      }

      if (s.spotifyConfigured && s.spotifyLinked) {
        const pRes = await fetch("/api/spotify/now-playing", { signal });
        if (signal?.aborted) return;
        if (pRes.status === 401) {
          setSpotifyPlayback(null);
          setSpotifyDevices([]);
        } else if (pRes.ok) {
          const data = (await pRes.json()) as { playback?: SpotifyPlayback | null };
          setSpotifyPlayback(data.playback ?? null);
          setSpotifySeekDraft(null);
        }

        await fetchSpotifyDevices(signal);
      } else {
        setSpotifyPlayback(null);
        setSpotifyDevices([]);
        setSpotifySeekDraft(null);
        setSpotifySdkReady(false);
        setSpotifySdkDeviceId(null);
        setSpotifySelectedDeviceId("");
      }

      if (s.weatherConfigured) {
        const wRes = await fetch("/api/weather", { signal });
        if (signal?.aborted) return;
        if (wRes.status === 501) {
          setWeather(null);
        } else if (wRes.ok) {
          setWeather((await wRes.json()) as Record<string, unknown>);
        }
      } else {
        setWeather(null);
      }

      if (s.catlinkConfigured) {
        const catRes = await fetch("/api/catlink", { signal });
        if (signal?.aborted) return;
        if (catRes.status === 501) {
          setCatlink(null);
        } else if (catRes.ok) {
          setCatlink((await catRes.json()) as CatlinkSnapshot);
        } else {
          setCatlink(null);
        }
      } else {
        setCatlink(null);
      }

      if (s.googleLinked && s.nestConfigured) {
        const nRes = await fetch("/api/nest/indoor", { signal });
        if (signal?.aborted) return;
        const data = (await nRes.json().catch(() => ({}))) as IndoorClimate & {
          error?: string;
        };
        if (nRes.ok) {
          setIndoorClimate(data);
        } else {
          setIndoorClimate({
            hasData: false,
            error: data.error || "Nest indoor climate unavailable.",
            history: data.history,
          });
        }
      } else {
        setIndoorClimate(null);
      }
    },
    [fetchIso.from, fetchIso.to, selectedCalendarId, fetchSpotifyDevices],
  );

  useEffect(() => {
    const ac = new AbortController();
    const id = window.setTimeout(() => {
      void fetchBoard(ac.signal).catch(() => {});
    }, 0);
    return () => {
      window.clearTimeout(id);
      ac.abort();
    };
  }, [fetchBoard]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const ac = new AbortController();
      void fetchBoard(ac.signal).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [fetchBoard]);

  useEffect(() => {
    if (!status?.spotifyConfigured || !status.spotifyLinked) {
      spotifyPollDeviceIdRef.current = undefined;
      return;
    }

    let cancelled = false;

    async function tickSpotifyConnectState() {
      if (cancelled) return;
      try {
        const pRes = await fetch("/api/spotify/now-playing");
        if (cancelled) return;
        if (pRes.status === 401) {
          setSpotifyPlayback(null);
          setSpotifyDevices([]);
          spotifyPollDeviceIdRef.current = undefined;
          return;
        }
        if (!pRes.ok) return;
        const data = (await pRes.json()) as { playback?: SpotifyPlayback | null };
        if (cancelled) return;
        const playback = data.playback ?? null;
        const nextId = playback?.device?.id ?? null;
        const deviceChanged = spotifyPollDeviceIdRef.current !== nextId;
        if (deviceChanged) {
          spotifyPollDeviceIdRef.current = nextId;
          setSpotifySeekDraft(null);
          await fetchSpotifyDevices();
          if (cancelled) return;
        }
        if (!cancelled) setSpotifyPlayback(playback);
      } catch {
        /* ignore transient network errors */
      }
    }

    void tickSpotifyConnectState();
    const intervalId = window.setInterval(() => void tickSpotifyConnectState(), 6000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [status?.spotifyConfigured, status?.spotifyLinked, fetchSpotifyDevices]);

  useEffect(() => {
    if (!status?.spotifyConfigured || !status.spotifyLinked) {
      spotifyPlayerRef.current?.disconnect();
      spotifyPlayerRef.current = null;
      return;
    }

    let cancelled = false;

    const setup = () => {
      if (cancelled) return;
      const sdk = window.Spotify;
      if (!sdk?.Player) return;
      if (spotifyPlayerRef.current) return;

      const player = new sdk.Player({
        name: "FamilyBoard Web Player",
        getOAuthToken: (cb) => {
          void fetch("/api/spotify/sdk-token")
            .then((r) => r.json())
            .then((j: { accessToken?: string }) => cb(j.accessToken ?? ""))
            .catch(() => cb(""));
        },
        volume: 0.7,
      });

      player.addListener("ready", (arg) => {
        if (cancelled) return;
        const x = arg as { device_id?: string };
        if (x.device_id) setSpotifySdkDeviceId(x.device_id);
        setSpotifySdkReady(true);
        void fetchBoard();
      });
      player.addListener("not_ready", () => {
        if (cancelled) return;
        setSpotifySdkReady(false);
      });
      player.addListener("authentication_error", (arg) => {
        if (cancelled) return;
        const x = arg as { message?: string };
        setSpotifyNotice(`Spotify web player auth error${x.message ? `: ${x.message}` : ""}`);
      });
      player.addListener("account_error", (arg) => {
        if (cancelled) return;
        const x = arg as { message?: string };
        setSpotifyNotice(
          `Spotify web player account error${x.message ? `: ${x.message}` : ""}`,
        );
      });
      player.addListener("playback_error", (arg) => {
        if (cancelled) return;
        const x = arg as { message?: string };
        setSpotifyNotice(
          `Spotify web player playback error${x.message ? `: ${x.message}` : ""}`,
        );
      });

      void player.connect().then((ok) => {
        if (cancelled) return;
        setSpotifySdkReady(ok);
      });
      spotifyPlayerRef.current = player;
    };

    const existing = document.querySelector(
      'script[src="https://sdk.scdn.co/spotify-player.js"]',
    ) as HTMLScriptElement | null;
    if (window.Spotify?.Player) {
      setup();
    } else if (existing) {
      const prev = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        prev?.();
        setup();
      };
    } else {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
      const prev = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        prev?.();
        setup();
      };
    }

    return () => {
      cancelled = true;
    };
  }, [status?.spotifyConfigured, status?.spotifyLinked, fetchBoard]);

  useEffect(() => {
    const knownIds = new Set(
      spotifyDevices.map((d) => d.id).filter((id): id is string => Boolean(id)),
    );
    const activeDeviceId =
      spotifyDevices.find((d) => d.is_active)?.id ?? spotifyPlayback?.device?.id ?? "";
    if (spotifySdkDeviceId) knownIds.add(spotifySdkDeviceId);
    if (knownIds.size === 0) {
      if (spotifySelectedDeviceId) {
        queueMicrotask(() => {
          setSpotifySelectedDeviceId("");
        });
      }
      return;
    }
    if (spotifySelectedDeviceId && knownIds.has(spotifySelectedDeviceId)) return;
    const preferred = activeDeviceId || spotifySdkDeviceId || "";
    queueMicrotask(() => {
      setSpotifySelectedDeviceId(preferred);
    });
  }, [spotifyDevices, spotifyPlayback?.device?.id, spotifySdkDeviceId, spotifySelectedDeviceId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SPOTIFY_KNOWN_DEVICES_KEY,
        JSON.stringify(spotifyKnownDevices.slice(0, 64)),
      );
    } catch {
      // ignore storage failures
    }
  }, [spotifyKnownDevices]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SPOTIFY_RECENT_ITEMS_KEY,
        JSON.stringify(spotifyRecentItems.slice(0, 30)),
      );
    } catch {
      // ignore storage failures
    }
  }, [spotifyRecentItems]);

  function addSpotifyRecentItem(item: Omit<SpotifyRecentItem, "addedAt">) {
    setSpotifyRecentItems((prev) => {
      const deduped = prev.filter((x) => !(x.kind === item.kind && x.id === item.id));
      return [{ ...item, addedAt: Date.now() }, ...deduped].slice(0, 30);
    });
  }

  function mergeSpotifyRecentItems(
    primary: SpotifyRecentItem[],
    secondary: SpotifyRecentItem[],
  ): SpotifyRecentItem[] {
    const byKey = new Map<string, SpotifyRecentItem>();
    for (const item of [...primary, ...secondary]) {
      const key = `${item.kind}:${item.id}`;
      const existing = byKey.get(key);
      if (!existing || item.addedAt > existing.addedAt) {
        byKey.set(key, item);
      }
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 30);
  }

  const refreshSpotifyAccountRecent = useCallback(async () => {
    setSpotifyRecentError(null);
    const res = await fetch("/api/spotify/recent?limit=20");
    if (!res.ok) {
      setSpotifyRecentSource("local");
      if (res.status === 403) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          j.error ??
          "Recent playback scope missing. Re-link Spotify to enable account recent history.";
        setSpotifyNotice(msg);
        setSpotifyRecentError(msg);
      } else {
        setSpotifyRecentError("Could not load Spotify account recent history.");
      }
      return;
    }
    const data = (await res.json()) as { recent?: SpotifyRecentItem[] };
    const recent = data.recent ?? [];
    if (recent.length > 0) setSpotifyRecentSource("account");
    setSpotifyRecentItems((prev) => mergeSpotifyRecentItems(recent, prev));
  }, []);

  const refreshSpotifyFeatured = useCallback(async () => {
    setSpotifyFeaturedError(null);
    setSpotifyFeaturedLoading(true);
    try {
      const res = await fetch("/api/spotify/featured?limit=20");
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSpotifyFeaturedError(j.error || "Could not load featured playlists.");
        return;
      }
      const data = (await res.json()) as { playlists?: SpotifySearchPlaylist[] };
      setSpotifyFeaturedPlaylists(data.playlists ?? []);
    } finally {
      setSpotifyFeaturedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (spotifySeekDraft !== null) return;
    const anchorMs = Math.max(0, Number(spotifyPlayback?.progress_ms ?? 0));
    const now = Date.now();
    queueMicrotask(() => {
      setSpotifyProgressAnchorMs(anchorMs);
      setSpotifyProgressAnchorAtMs(now);
      setSpotifyProgressNowMs(now);
    });
  }, [spotifyPlayback?.progress_ms, spotifyPlayback?.is_playing, spotifyPlayback?.item?.id, spotifySeekDraft]);

  useEffect(() => {
    if (!spotifyPlayback?.is_playing || spotifySeekDraft !== null) return;
    const id = window.setInterval(() => {
      setSpotifyProgressNowMs(Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [spotifyPlayback?.is_playing, spotifySeekDraft, spotifyProgressAnchorAtMs]);

  useEffect(() => {
    if (spotifyVolumePending === null) return;
    const device =
      spotifyDevices.find((d) => d.is_active) ?? spotifyPlayback?.device ?? null;
    const confirmed = Math.round(device?.volume_percent ?? -1);
    if (confirmed === spotifyVolumePending) {
      setSpotifyVolumePending(null);
    }
  }, [spotifyVolumePending, spotifyDevices, spotifyPlayback?.device]);

  function openNewEventModal(forDay?: Date) {
    setNewSummary("");
    setNewAllDay(false);
    setNewTimes(initialNewEventRange(forDay));
    setNewEventOpen(true);
  }

  function onNewAllDayChange(checked: boolean) {
    if (checked) {
      setNewTimes((t) => {
        const s = new Date(t.start);
        const e = new Date(t.end);
        const startKey = Number.isNaN(s.getTime())
          ? dateKeyLocal(new Date())
          : dateKeyLocal(s);
        let endKey = Number.isNaN(e.getTime()) ? startKey : dateKeyLocal(e);
        if (parseLocalDateKey(endKey) < parseLocalDateKey(startKey)) endKey = startKey;
        return { start: startKey, end: endKey };
      });
    } else {
      setNewTimes((t) => {
        const sk = t.start.trim();
        const ek = t.end.trim();
        if (!DATE_KEY_RE.test(sk) || !DATE_KEY_RE.test(ek)) {
          return initialNewEventRange();
        }
        const startD = parseLocalDateKey(sk);
        const lastD = parseLocalDateKey(ek);
        const last = lastD < startD ? startD : lastD;
        return {
          start: dateKeyToDatetimeLocal(dateKeyLocal(startD), 9, 0),
          end: dateKeyToDatetimeLocal(dateKeyLocal(last), 10, 0),
        };
      });
    }
    setNewAllDay(checked);
  }

  async function addEvent() {
    if (selectedCalendarId === "__all__") {
      setMessage("Pick a specific calendar before creating a new event.");
      return;
    }
    setBusy("add");
    setMessage(null);

    let payload: Record<string, unknown>;
    if (newAllDay) {
      const startKey = newTimes.start.trim();
      const lastInclusive = newTimes.end.trim();
      if (!DATE_KEY_RE.test(startKey) || !DATE_KEY_RE.test(lastInclusive)) {
        setBusy(null);
        setMessage("Start and end must be valid dates.");
        return;
      }
      const startD = parseLocalDateKey(startKey);
      const lastD = parseLocalDateKey(lastInclusive);
      if (lastD < startD) {
        setBusy(null);
        setMessage("End date must be on or after the start date.");
        return;
      }
      const exclusiveEnd = dateKeyLocal(addDays(lastD, 1));
      payload = {
        summary: newSummary,
        calendarId: selectedCalendarId,
        allDay: true,
        startDate: startKey,
        endDate: exclusiveEnd,
      };
    } else {
      payload = {
        summary: newSummary,
        start: new Date(newTimes.start).toISOString(),
        end: new Date(newTimes.end).toISOString(),
        calendarId: selectedCalendarId,
      };
    }

    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not create event");
      return;
    }
    setMessage("Event created.");
    setNewEventOpen(false);
    await fetchBoard();
  }

  function openEdit(ev: CalendarEvent) {
    if (!ev.id) {
      setMessage("Could not open this event.");
      return;
    }
    if (ev.start?.date) {
      const startKey = ev.start.date;
      const exclusiveEnd =
        ev.end?.date ?? dateKeyLocal(addDays(parseLocalDateKey(startKey), 1));
      setEditOpen(ev);
      setEditAllDay(true);
      setEditSummary(ev.summary ?? "");
      setEditStart(startKey);
      setEditEnd(inclusiveLastDayFromGoogleAllDayEnd(exclusiveEnd));
      return;
    }
    const s = ev.start?.dateTime;
    const e = ev.end?.dateTime;
    if (!s || !e) {
      setMessage("Could not open this event.");
      return;
    }
    setEditOpen(ev);
    setEditAllDay(false);
    setEditSummary(ev.summary ?? "");
    setEditStart(toInputValue(s));
    setEditEnd(toInputValue(e));
  }

  async function saveEdit() {
    if (!editOpen?.id) return;
    const eventCalendarId =
      (editOpen as CalendarEvent).sourceCalendarId ?? selectedCalendarId;
    if (eventCalendarId === "__all__") {
      setMessage("Unable to determine event calendar. Please refresh and try again.");
      return;
    }
    setBusy("save");
    setMessage(null);

    let patchBody: Record<string, unknown>;
    if (editAllDay) {
      const startKey = editStart.trim();
      const lastInclusive = editEnd.trim();
      if (!DATE_KEY_RE.test(startKey) || !DATE_KEY_RE.test(lastInclusive)) {
        setBusy(null);
        setMessage("Start and end must be valid dates.");
        return;
      }
      const startD = parseLocalDateKey(startKey);
      const lastD = parseLocalDateKey(lastInclusive);
      if (lastD < startD) {
        setBusy(null);
        setMessage("End date must be on or after the start date.");
        return;
      }
      const exclusiveEnd = dateKeyLocal(addDays(lastD, 1));
      patchBody = {
        summary: editSummary,
        allDay: true,
        startDate: startKey,
        endDate: exclusiveEnd,
      };
    } else {
      patchBody = {
        summary: editSummary,
        start: new Date(editStart).toISOString(),
        end: new Date(editEnd).toISOString(),
      };
    }

    const res = await fetch(
      `/api/calendar/events/${encodeURIComponent(editOpen.id)}?calendarId=${encodeURIComponent(eventCalendarId)}`,
      {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
      },
    );
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not update event");
      return;
    }
    setEditOpen(null);
    setEditAllDay(false);
    setMessage("Event updated.");
    await fetchBoard();
  }

  async function deleteEdit() {
    if (!editOpen?.id) return;
    const eventCalendarId =
      (editOpen as CalendarEvent).sourceCalendarId ?? selectedCalendarId;
    if (eventCalendarId === "__all__") {
      setMessage("Unable to determine event calendar. Please refresh and try again.");
      return;
    }
    setBusy("delete");
    setMessage(null);
    const res = await fetch(
      `/api/calendar/events/${encodeURIComponent(editOpen.id)}?calendarId=${encodeURIComponent(eventCalendarId)}`,
      {
        method: "DELETE",
      },
    );
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not delete event");
      return;
    }
    setEditOpen(null);
    setEditAllDay(false);
    setMessage("Event deleted.");
    await fetchBoard();
  }

  async function toggleArea(id: string, on: boolean) {
    setBusy(`hue-${id}`);
    const res = await fetch(`/api/hue/areas/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Hue request failed");
      return;
    }
    await fetchBoard();
  }

  async function applyHueTheme(id: string, theme: HueThemeKey) {
    setBusy(`hue-theme-${id}`);
    const res = await fetch(`/api/hue/areas/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Hue request failed");
      return;
    }
    await fetchBoard();
  }

  async function pairHue() {
    setBusy("pair");
    setMessage(null);
    const res = await fetch("/api/hue/pair", { method: "POST" });
    setBusy(null);
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      hint?: string;
    };
    if (!res.ok) {
      setMessage([j.error, j.hint].filter(Boolean).join(" — "));
      return;
    }
    setMessage("Hue bridge paired. Lights should appear shortly.");
    await fetchBoard();
  }

  async function linkCatlink() {
    setBusy("catlink-link");
    setMessage(null);
    const res = await fetch("/api/catlink/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: catlinkLinkPhone.trim(),
        password: catlinkLinkPassword.trim(),
      }),
    });
    setBusy(null);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(j.error ?? "Could not link Catlink");
      return;
    }
    setCatlinkLinkPassword("");
    setMessage("Catlink linked.");
    await fetchBoard();
  }

  async function unlinkCatlink() {
    setBusy("catlink-unlink");
    setMessage(null);
    const res = await fetch("/api/catlink/auth/unlink", { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not unlink Catlink");
      return;
    }
    setMessage("Catlink unlinked.");
    await fetchBoard();
  }

  async function catlinkControl(action: CatlinkAction) {
    setBusy(`catlink-${action}`);
    setMessage(null);
    const res = await fetch("/api/catlink/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(j.error ?? "Catlink action failed");
      return;
    }
    await fetchBoard();
  }

  async function logoutGoogle() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearCalendarExplicitChoice();
    setMessage("Disconnected Google.");
    await fetchBoard();
  }

  async function disconnectSpotify() {
    setBusy("spotify-disconnect");
    setMessage(null);
    const res = await fetch("/api/auth/spotify/logout", { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not disconnect Spotify");
      return;
    }
    setMessage("Disconnected Spotify.");
    await fetchBoard();
  }

  async function spotifyControl(
    action:
      | "play"
      | "pause"
      | "next"
      | "previous"
      | "set_volume"
      | "set_device"
      | "seek"
      | "play_track"
      | "play_context"
      | "queue_track",
    extra?: Record<string, unknown>,
  ): Promise<boolean> {
    setSpotifyNotice(null);
    const requestedDeviceId =
      typeof extra?.deviceId === "string" && extra.deviceId.trim()
        ? extra.deviceId
        : null;
    const requestedDeviceIsSelectable = requestedDeviceId
      ? requestedDeviceId === spotifySdkDeviceId || spotifyLiveDeviceIds.has(requestedDeviceId)
      : true;
    if (bodyActionNeedsLiveDevice(action) && requestedDeviceId && !requestedDeviceIsSelectable) {
      setSpotifyNotice(
        "Selected device is not currently online in Spotify. Open Spotify on that device first, then refresh devices.",
      );
      return false;
    }
    const intendedDeviceId = requestedDeviceId || spotifyEffectiveDeviceId || null;
    if (
      (action === "play" || action === "play_track" || action === "play_context") &&
      spotifySdkReady &&
      intendedDeviceId === spotifySdkDeviceId
    ) {
      try {
        await spotifyPlayerRef.current?.activateElement?.();
      } catch {
        // Ignore and continue with API controls.
      }
    }
    if (
      (action === "play" ||
        action === "play_track" ||
        action === "play_context" ||
        action === "queue_track") &&
      !spotifyEffectiveDeviceId &&
      !spotifySdkDeviceId &&
      !extra?.deviceId
    ) {
      const msg =
        "No active Spotify device. Select a Spotify Connect device, then try again.";
      setDismissedAlertSignature(null);
      setMessage(msg);
      setSpotifyNotice(msg);
      return false;
    }
    setBusy(`spotify-${action}`);
    setMessage(null);
    const payload: Record<string, unknown> = { action, ...(extra ?? {}) };
    if (
      typeof payload.deviceId === "string" &&
      payload.deviceId &&
      payload.deviceId !== spotifySdkDeviceId &&
      !spotifyLiveDeviceIds.has(payload.deviceId)
    ) {
      delete payload.deviceId;
    }
    if (
      (action === "play_track" || action === "play_context" || action === "queue_track") &&
      !payload.deviceId
    ) {
      const fallbackDevice = spotifyEffectiveDeviceId || spotifySdkDeviceId;
      if (fallbackDevice) payload.deviceId = fallbackDevice;
    }
    const res = await fetch("/api/spotify/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(null);
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
      detail?: { error?: { message?: string; reason?: string } | string };
    };
    if (!res.ok) {
      const detail =
        typeof j.detail?.error === "string"
          ? j.detail.error
          : j.detail?.error?.reason || j.detail?.error?.message;
      setDismissedAlertSignature(null);
      const combined = [j.error, detail].filter(Boolean).join(" — ");
      const msg = combined.includes("NO_ACTIVE_DEVICE")
        ? "Spotify has no active device yet. Select a Spotify Connect device, then retry."
        : combined || "Spotify action failed";
      setMessage(msg);
      setSpotifyNotice(msg);
      return false;
    }
    if (j.warning) {
      setDismissedAlertSignature(null);
      setMessage(j.warning);
      setSpotifyNotice(j.warning);
    }
    setSpotifySeekDraft(null);
    await fetchBoard();
    if (action === "play_track" || action === "play_context" || action === "play") {
      const probe = await fetch("/api/spotify/now-playing");
      if (probe.ok) {
        const data = (await probe.json()) as { playback?: { is_playing?: boolean } | null };
        if (!data.playback?.is_playing) {
          const msg =
            "Command sent, but Spotify is still not playing. Activate target device in Spotify app, then try again.";
          setDismissedAlertSignature(null);
          setMessage(msg);
          setSpotifyNotice(msg);
          return false;
        }
      }
    }
    return true;
  }

  function bodyActionNeedsLiveDevice(
    action:
      | "play"
      | "pause"
      | "next"
      | "previous"
      | "set_volume"
      | "set_device"
      | "seek"
      | "play_track"
      | "play_context"
      | "queue_track",
  ): boolean {
    return action === "set_device" || action === "play" || action === "play_track" || action === "play_context" || action === "queue_track";
  }

  async function commitSpotifySeek() {
    if (spotifySeekDraft === null) return;
    const duration = Number(spotifyTrack?.duration_ms ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const clamped = Math.max(0, Math.min(duration, Math.round(spotifySeekDraft)));
    await spotifyControl("seek", { positionMs: clamped });
  }

  async function adjustSpotifyVolume(delta: number) {
    const device = spotifyDevices.find((d) => d.is_active) ?? spotifyPlayback?.device;
    if (!device) return;
    const confirmed = Math.round(device.volume_percent ?? 0);
    const current = spotifyVolumePending ?? confirmed;
    const next = Math.max(0, Math.min(100, current + delta));
    if (next === confirmed && spotifyVolumePending === null) return;
    setSpotifyVolumePending(next);
    const ok = await spotifyControl("set_volume", { volumePercent: next });
    if (!ok) setSpotifyVolumePending(null);
  }

  function spotifyContextUri(
    kind: "album" | "playlist",
    id?: string,
    uri?: string,
  ): string | undefined {
    const cleanId = (id ?? "").trim();
    if (cleanId) return `spotify:${kind}:${cleanId}`;
    const cleanUri = (uri ?? "").trim();
    return cleanUri || undefined;
  }

  const searchSpotify = useCallback(async () => {
    const q = spotifyQuery.trim();
    if (!q) {
      setSpotifySearchResults({ tracks: [], albums: [], playlists: [] });
      setSpotifySearching(false);
      return;
    }
    const seq = ++spotifySearchSeq.current;
    setSpotifySearching(true);
    try {
      const res = await fetch(
        `/api/spotify/search?q=${encodeURIComponent(q)}&limit=8`,
      );
      if (seq !== spotifySearchSeq.current) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: { error?: { message?: string; reason?: string } | string };
        };
        const detail =
          typeof j.detail?.error === "string"
            ? j.detail.error
            : j.detail?.error?.reason || j.detail?.error?.message;
        const msg = [j.error, detail].filter(Boolean).join(" — ") || "Spotify search failed";
        setMessage(msg);
        setSpotifyNotice(msg);
        return;
      }
      const data = (await res.json()) as {
        tracks?: SpotifySearchTrack[];
        albums?: SpotifySearchAlbum[];
        playlists?: SpotifySearchPlaylist[];
      };
      if (seq !== spotifySearchSeq.current) return;
      const next = {
        tracks: data.tracks ?? [],
        albums: data.albums ?? [],
        playlists: data.playlists ?? [],
      };
      setSpotifySearchResults(next);
      setSpotifyResultTab("results");
    } finally {
      if (seq === spotifySearchSeq.current) {
        setSpotifySearching(false);
      }
    }
  }, [spotifyQuery]);

  useEffect(() => {
    if (!spotifyPickOpen) return;
    const q = spotifyQuery.trim();
    if (q.length < 1) {
      spotifySearchSeq.current += 1;
      queueMicrotask(() => {
        setSpotifySearching(false);
        setSpotifySearchResults({ tracks: [], albums: [], playlists: [] });
      });
      return;
    }
    setSpotifyResultTab("results");
    const id = window.setTimeout(() => void searchSpotify(), 420);
    return () => window.clearTimeout(id);
  }, [spotifyPickOpen, spotifyQuery, searchSpotify]);

  useEffect(() => {
    if (!spotifyPickOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSpotifyPickOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotifyPickOpen]);

  useEffect(() => {
    if (!spotifyPickOpen) return;
    queueMicrotask(() => spotifyPickInputRef.current?.focus());
  }, [spotifyPickOpen]);

  useEffect(() => {
    if (!spotifyPickOpen) return;
    if (spotifyResultTab !== "recent") return;
    queueMicrotask(() => {
      void refreshSpotifyAccountRecent();
    });
  }, [spotifyPickOpen, spotifyResultTab, refreshSpotifyAccountRecent]);

  useEffect(() => {
    if (!spotifyPickOpen) return;
    if (spotifyResultTab !== "featured") return;
    if (spotifyFeaturedPlaylists.length > 0) return;
    queueMicrotask(() => {
      void refreshSpotifyFeatured();
    });
  }, [spotifyPickOpen, spotifyResultTab, spotifyFeaturedPlaylists.length, refreshSpotifyFeatured]);

  async function refreshSpotifyDevices() {
    setBusy("spotify-refresh-devices");
    setSpotifyNotice(null);
    const res = await fetch("/api/spotify/devices");
    if (res.ok) {
      const data = (await res.json()) as { devices?: SpotifyDevice[] };
      const latest = data.devices ?? [];
      setSpotifyDevices(latest);
      setSpotifyKnownDevices((prev) => mergeSpotifyDevices(latest, prev));
      if (latest.length === 0) {
        setSpotifyNotice(
          "No Spotify device yet. Open Spotify on your phone, choose a speaker/device there, then tap Refresh devices again.",
        );
      }
    } else {
      await fetchBoard();
    }
    setBusy(null);
  }

  function goCalendarPreviousMonth() {
    setRangeKeys((prev) => shiftCalendarRangeByMonth(prev, -1));
  }

  function goCalendarNextMonth() {
    setRangeKeys((prev) => shiftCalendarRangeByMonth(prev, 1));
  }

  function goCalendarTodayWeeks() {
    setRangeKeys(defaultCalendarRangeKeys(DEFAULT_HOME_CALENDAR_WEEKS));
  }

  const current = weather?.current as
    | { temperatureF?: number; humidity?: number; code?: number; windMph?: number }
    | undefined;
  const daily = weather?.daily as DailyForecast[] | undefined;
  const calendarDailyForecast = useMemo(
    () => dailyForecastByDate(daily),
    [daily],
  );
  const hourlyNext12 = weather?.hourlyNext12 as WeatherHourlyPoint[] | undefined;
  const todayForecast = daily?.[0];
  const catlinkCatName =
    typeof catlink?.catName === "string" && catlink.catName ? catlink.catName : null;
  const catlinkCatWeightKg =
    typeof catlink?.catWeightKg === "number" ? catlink.catWeightKg : null;
  const catlinkPeeToday =
    typeof catlink?.peeCountToday === "number" ? Math.round(catlink.peeCountToday) : null;
  const catlinkPoopToday =
    typeof catlink?.poopCountToday === "number" ? Math.round(catlink.poopCountToday) : null;
  const catlinkWasteBinFull =
    typeof catlink?.wasteBinFull === "boolean" ? catlink.wasteBinFull : null;
  const catlinkWasteBinStatusLabel =
    typeof catlink?.wasteBinStatusLabel === "string" && catlink.wasteBinStatusLabel
      ? catlink.wasteBinStatusLabel
      : null;
  const spotifyTrack = spotifyPlayback?.item;
  const spotifyArtist = spotifyTrack?.artists?.map((a) => a.name).filter(Boolean).join(", ");
  const spotifyActiveDevice =
    spotifyDevices.find((d) => d.is_active) ?? spotifyPlayback?.device ?? null;
  const spotifyVolumeConfirmed = Math.round(spotifyActiveDevice?.volume_percent ?? 0);
  const spotifyVolumeDisplay = spotifyVolumePending ?? spotifyVolumeConfirmed;
  const spotifyVolumeIsPending = spotifyVolumePending !== null;
  const spotifyVolumeBusy = busy === "spotify-set_volume";
  const spotifyEffectiveDeviceId =
    spotifySelectedDeviceId || spotifyActiveDevice?.id || spotifySdkDeviceId || "";
  const spotifySdkInDeviceList = Boolean(
    spotifySdkDeviceId && spotifyDevices.some((d) => d.id === spotifySdkDeviceId),
  );
  const spotifyCover = spotifyTrack?.album?.images?.[0]?.url;
  const hueAnyOn = hueAnyLightOn || areas.some((a) => a.on);
  const indoorTitleTempF = useMemo(() => {
    const direct = indoorClimate?.temperatureF;
    if (direct != null && Number.isFinite(direct)) return direct;
    const hist = indoorClimate?.history;
    if (!hist?.length) return null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const t = hist[i]?.temperatureF;
      if (t != null && Number.isFinite(t)) return t;
    }
    return null;
  }, [indoorClimate]);
  const pinnedHueAreas = useMemo(() => {
    const byName = new Map(
      areas.map((a) => [a.name.trim().toLowerCase(), a] as const),
    );
    const ordered = HUE_PINNED_ORDER.map((name) => byName.get(name)).filter(
      (x): x is HueArea => Boolean(x),
    );
    return ordered;
  }, [areas]);
  const pinnedHueIds = useMemo(() => new Set(pinnedHueAreas.map((a) => a.id)), [pinnedHueAreas]);
  const otherHueAreas = useMemo(
    () =>
      areas
        .filter((a) => !pinnedHueIds.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [areas, pinnedHueIds],
  );
  const spotifyLiveDeviceIds = new Set(
    spotifyDevices.map((d) => d.id).filter((id): id is string => Boolean(id)),
  );
  const spotifyDeviceOptions = useMemo(() => {
    const live = mergeSpotifyDevices(spotifyDevices, []);
    if (live.length > 0) return live;
    return mergeSpotifyDevices(spotifyKnownDevices, []).slice(0, 8);
  }, [spotifyDevices, spotifyKnownDevices]);
  const spotifyIsPlaying = Boolean(spotifyPlayback?.is_playing);
  const spotifyDurationMs = Math.max(0, Number(spotifyTrack?.duration_ms ?? 0));
  const spotifyProgressBaseMs =
    spotifySeekDraft !== null
      ? Number(spotifySeekDraft)
      : spotifyPlayback?.is_playing
        ? spotifyProgressAnchorMs + (spotifyProgressNowMs - spotifyProgressAnchorAtMs)
        : Number(spotifyPlayback?.progress_ms ?? spotifyProgressAnchorMs);
  const spotifyProgressMs = Math.max(
    0,
    Math.min(spotifyDurationMs || Number.MAX_SAFE_INTEGER, Number(spotifyProgressBaseMs)),
  );
  const clockDate = clockNow.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const clockTime = clockNow.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const formatSunClock = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const clockSunrise = formatSunClock(sunriseToday);
  const clockSunset = formatSunClock(sunsetToday);
  const todayAllDayStrip = useMemo(() => {
    const today = new Date();
    return todayEvents
      .map((ev) => {
        const b = getEventBounds(ev);
        if (!b || b.kind !== "allday") return null;
        if (!eventOverlapsLocalDay(ev, today)) return null;
        return {
          kind: "allday" as const,
          key: ev.id ?? `allday-${b.startKey}-${ev.summary ?? "event"}`,
          summary: ev.summary || "(No title)",
          event: ev,
        };
      })
      .filter(
        (x): x is {
          kind: "allday";
          key: string;
          summary: string;
          event: CalendarEvent;
        } => Boolean(x),
      );
  }, [todayEvents]);

  const todayTimedStrip = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(20, 0, 0, 0);
    const fmt = (d: Date) =>
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return todayEvents
      .map((ev) => {
        const b = getEventBounds(ev);
        if (!b || b.kind !== "timed") return null;
        if (b.start >= dayEnd || b.end <= dayStart) return null;
        const start = new Date(Math.max(b.start.getTime(), dayStart.getTime()));
        const end = new Date(Math.min(b.end.getTime(), dayEnd.getTime()));
        return {
          kind: "timed" as const,
          key: ev.id ?? `${ev.summary ?? "event"}-${b.start.toISOString()}`,
          startMs: start.getTime(),
          startLabel: fmt(start),
          endLabel: fmt(end),
          summary: ev.summary || "(No title)",
          event: ev,
        };
      })
      .filter(
        (x): x is {
          kind: "timed";
          key: string;
          startMs: number;
          startLabel: string;
          endLabel: string;
          summary: string;
          event: CalendarEvent;
        } => Boolean(x),
      )
      .sort((a, b) => a.startMs - b.startMs)
      .slice(0, 20);
  }, [todayEvents]);
  const todayAllDayGlance = todayAllDayStrip.slice(0, 3);
  const todayTimedGlance = todayTimedStrip.slice(0, 5);
  const todayHiddenCount =
    Math.max(0, todayAllDayStrip.length - todayAllDayGlance.length) +
    Math.max(0, todayTimedStrip.length - todayTimedGlance.length);

  return (
    <>
    <div
      className={`flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-base text-slate-100 sm:text-lg ${
        nightGreyscale ? "grayscale" : ""
      }`}
    >
      <div className="box-border flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-2 py-2 sm:gap-3 sm:px-4 sm:py-3 md:gap-4 lg:px-6 lg:py-4 xl:px-8 xl:py-5 2xl:px-10">
        {showBanner ? (
          <div className="flex shrink-0 items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/60 py-2 pl-3 pr-2 text-base text-slate-100 sm:text-lg">
            <p className="min-w-0 flex-1 pt-0.5 leading-snug">{alertText}</p>
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-700/80 hover:text-white"
              aria-label="Dismiss notification"
              onClick={dismissAlertBanner}
            >
              <span className="block text-lg leading-none" aria-hidden>
                ×
              </span>
            </button>
          </div>
        ) : null}

        <div className="board-scrollbar grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto sm:gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-3 md:p-4">
            <div className="mb-3 flex min-w-0 shrink-0 items-start gap-3 rounded-xl border border-slate-600 bg-slate-900 px-3 py-3 shadow-md shadow-black/30 sm:mb-4 sm:gap-4 sm:px-4 sm:py-3.5">
              <span className="shrink-0 pt-1 text-lg font-bold tracking-tight text-white sm:text-xl">
                Today
              </span>
              <div className="min-w-0 flex-1">
                {todayAllDayStrip.length === 0 && todayTimedStrip.length === 0 ? (
                  <span className="pt-1 text-base text-slate-300 sm:text-lg">
                    No events 8am–8pm.
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2 sm:gap-2.5">
                    {todayAllDayGlance.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openEdit(item.event)}
                        className={`inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-left shadow-sm hover:brightness-110 sm:max-w-[22rem] sm:px-3.5 sm:py-2.5 ${eventBarClass(item.summary)}`}
                        title={item.summary}
                      >
                        <span className="shrink-0 text-sm font-bold uppercase tracking-wide opacity-90 sm:text-base">
                          All day
                        </span>
                        <span className="truncate text-base font-semibold sm:text-lg">
                          {item.summary}
                        </span>
                      </button>
                    ))}
                    {todayTimedGlance.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openEdit(item.event)}
                        className={`inline-flex max-w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left shadow-sm hover:brightness-110 sm:max-w-[26rem] sm:px-3.5 sm:py-2.5 ${eventBarClass(item.summary)}`}
                        title={`${item.startLabel}–${item.endLabel} ${item.summary}`}
                      >
                        <span className="shrink-0 text-base font-bold tabular-nums sm:text-lg">
                          {item.startLabel}
                        </span>
                        <span className="truncate text-base font-semibold sm:text-lg">
                          {item.summary}
                        </span>
                      </button>
                    ))}
                    {todayHiddenCount > 0 ? (
                      <span className="inline-flex items-center rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-base font-medium text-slate-200 sm:text-lg">
                        +{todayHiddenCount} more
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            {!status?.googleConfigured ? (
              <p className="mt-4 text-base text-slate-400 sm:text-lg">
                Set{" "}
                <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                  GOOGLE_CLIENT_ID
                </code>{" "}
                and{" "}
                <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                  GOOGLE_CLIENT_SECRET
                </code>{" "}
                on the server, then restart the app.
              </p>
            ) : null}
            {status?.googleConfigured && !status.googleLinked ? (
              <div className="mt-3">
                <a
                  className="inline-flex rounded-full bg-white px-5 py-2.5 text-base font-medium text-slate-900 hover:bg-slate-100 sm:text-lg"
                  href="/api/auth/google"
                >
                  Link Google
                </a>
              </div>
            ) : null}

            {status?.googleLinked ? (
              <>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-2 sm:pt-3">
                  {weekStarts.length === 0 ? (
                    <p className="text-base text-slate-400 sm:text-lg">
                      No weeks in this range.
                    </p>
                  ) : (
                    <div className="board-scrollbar flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                      <CompactCalendarGrid
                        weekStarts={weekStarts}
                        events={events}
                        dailyForecastByDate={
                          status?.weatherConfigured ? calendarDailyForecast : undefined
                        }
                        showCalendarSource={selectedCalendarId === "__all__"}
                        comfortable={calendarComfortable}
                        onSelectEvent={(ev) => openEdit(ev)}
                        onDoubleClickDay={(day) => openNewEventModal(day)}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-800 pt-3 sm:gap-2">
                  <label className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-300 sm:text-base">
                    Calendar
                    <select
                      className="rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none sm:text-base"
                      value={selectedCalendarId}
                      onChange={(e) => {
                        markCalendarExplicitlyChosen();
                        setSelectedCalendarId(e.target.value);
                      }}
                    >
                      <option value="__all__">All calendars</option>
                      {calendars.length === 0 ? (
                        <option value="primary">primary</option>
                      ) : (
                        calendars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.summary}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={selectedCalendarId === "__all__"}
                    className="rounded-full bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-lg"
                    onClick={() => openNewEventModal()}
                  >
                    New event
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-slate-400 sm:px-4 sm:py-2.5 sm:text-base"
                      onClick={() => goCalendarPreviousMonth()}
                    >
                      Previous month
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-slate-400 sm:px-4 sm:py-2.5 sm:text-base"
                      onClick={() => goCalendarNextMonth()}
                    >
                      Next month
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-slate-400 sm:px-4 sm:py-2.5 sm:text-base"
                      onClick={() => goCalendarTodayWeeks()}
                    >
                      Today
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-slate-600 px-4 py-2 text-base text-slate-100 hover:border-slate-400 sm:py-2.5 sm:text-lg"
                    onClick={() => void fetchBoard()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-rose-900/60 px-4 py-2 text-base text-rose-100 hover:border-rose-700 sm:py-2.5 sm:text-lg"
                    onClick={() => void logoutGoogle()}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : null}
          </section>

          <div className="board-scrollbar flex h-full max-h-full min-h-0 min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-2 sm:gap-4">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.clock ? (
                    <ClockTimeTitleIcon time={clockTime} />
                  ) : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Clock</h2>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                  onClick={() => toggleWidgetCollapse("clock")}
                  aria-label={collapsedWidgets.clock ? "Expand clock" : "Collapse clock"}
                  title={collapsedWidgets.clock ? "Expand clock" : "Collapse clock"}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {collapsedWidgets.clock ? (
                      <path d="M6 15l6-6 6 6" />
                    ) : (
                      <path d="M6 9l6 6 6-6" />
                    )}
                  </svg>
                </button>
              </div>
              {!collapsedWidgets.clock ? (
                <div className="mt-3 flex min-h-[2.75rem] items-center justify-between gap-4 sm:min-h-[3rem]">
                  <p className="shrink-0 text-3xl font-semibold leading-none tabular-nums text-white sm:text-4xl">
                    {clockTime}
                  </p>
                  <div className="flex min-w-0 flex-col items-end justify-center gap-1 text-right leading-tight">
                    <p className="truncate text-sm uppercase tracking-wide text-slate-300 sm:text-base">
                      {clockDate}
                    </p>
                    <div className="flex items-center justify-end gap-3 tabular-nums text-sm font-medium text-slate-200 sm:gap-4 sm:text-base">
                      <span className="inline-flex items-center gap-1.5" title="Sunrise">
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          className="h-4 w-4 shrink-0 text-amber-300 sm:h-5 sm:w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 3v4M4.2 10.2l2.8 2.8M19.8 10.2l-2.8 2.8M3 17h18M8 21h8" />
                          <circle cx="12" cy="14" r="4" />
                        </svg>
                        {clockSunrise}
                      </span>
                      <span className="inline-flex items-center gap-1.5" title="Sunset">
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          className="h-4 w-4 shrink-0 text-indigo-300 sm:h-5 sm:w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17 18H7M12 9V3M4.2 15.8l2.8-2.8M19.8 15.8l-2.8-2.8" />
                          <path d="M6 21h12" />
                        </svg>
                        {clockSunset}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.weather ? (
                    current ? (
                      <WeatherIcon
                        code={Number(current.code ?? 0)}
                        isNight={nightGreyscale}
                        className={`${WIDGET_TITLE_ICON} text-sky-300`}
                      />
                    ) : (
                      <div
                        className={`${WIDGET_TITLE_ICON} rounded-lg border border-slate-700/80 bg-slate-950/50`}
                        aria-hidden
                      />
                    )
                  ) : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Weather</h2>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => void fetchBoard()}
                    aria-label="Refresh weather"
                    title="Refresh weather"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => toggleWidgetCollapse("weather")}
                    aria-label={collapsedWidgets.weather ? "Expand weather" : "Collapse weather"}
                    title={collapsedWidgets.weather ? "Expand weather" : "Collapse weather"}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {collapsedWidgets.weather ? (
                        <path d="M6 15l6-6 6 6" />
                      ) : (
                        <path d="M6 9l6 6 6-6" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
              {collapsedWidgets.weather ? null : !status?.weatherConfigured ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    WEATHER_LAT
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    WEATHER_LON
                  </code>
                  .
                </p>
              ) : current ? (
                <div className="mt-2 space-y-2.5">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <p className="text-4xl font-semibold leading-none text-white sm:text-5xl">
                        {Math.round(current.temperatureF ?? 0)}°
                        <span className="text-base text-slate-400 sm:text-lg">F</span>
                      </p>
                      <WeatherIcon
                        code={Number(current.code ?? 0)}
                        isNight={nightGreyscale}
                        className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
                      />
                    </div>
                    <div className="flex flex-col items-end gap-1.5 text-sm text-slate-300 sm:text-base">
                      {todayForecast &&
                      typeof todayForecast.minF === "number" &&
                      typeof todayForecast.maxF === "number" ? (
                        <span
                          className="whitespace-nowrap text-xs tabular-nums text-slate-400 sm:text-sm"
                          title="Today's forecast high / low"
                        >
                          <span className="font-semibold text-slate-100">
                            {Math.round(todayForecast.maxF)}°
                          </span>
                          <span className="mx-1 text-slate-500">/</span>
                          <span className="text-slate-300">
                            {Math.round(todayForecast.minF)}°
                          </span>
                        </span>
                      ) : null}
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-4 w-4 text-sky-300"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 3C12 3 6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11z" />
                          </svg>
                          {Math.round(current.humidity ?? 0)}%
                        </span>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-4 w-4 text-slate-300"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 9h10a3 3 0 1 0-3-3" />
                            <path d="M3 15h14a3 3 0 1 1-3 3" />
                          </svg>
                          {Math.round(current.windMph ?? 0)} mph
                        </span>
                      </div>
                    </div>
                  </div>
                  {hourlyNext12 && hourlyNext12.length > 0 ? (
                    <WeatherHourlyChart
                      hours={hourlyNext12}
                      sunriseToday={sunriseToday}
                      sunsetToday={sunsetToday}
                      className="h-32 shrink-0 sm:h-36"
                    />
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">Loading weather…</p>
              )}
            </section>

            <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.catlink ? (
                    <span
                      className={`${WIDGET_TITLE_ICON} flex items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 text-xs font-semibold tabular-nums text-white`}
                    >
                      {catlinkWasteBinFull
                        ? "!"
                        : catlinkCatWeightKg !== null
                          ? `${catlinkCatWeightKg.toFixed(1)}`
                          : "CAT"}
                    </span>
                  ) : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Catlink</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => void fetchBoard()}
                    aria-label="Refresh catlink"
                    title="Refresh catlink"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  {status?.catlinkLinked ? (
                    <button
                      type="button"
                      disabled={busy === "catlink-unlink"}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-rose-200 disabled:opacity-50"
                      onClick={() => void unlinkCatlink()}
                      aria-label="Unlink Catlink"
                      title="Unlink Catlink"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={`h-5 w-5 ${busy === "catlink-unlink" ? "animate-pulse" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => toggleWidgetCollapse("catlink")}
                    aria-label={collapsedWidgets.catlink ? "Expand catlink" : "Collapse catlink"}
                    title={collapsedWidgets.catlink ? "Expand catlink" : "Collapse catlink"}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {collapsedWidgets.catlink ? (
                        <path d="M6 15l6-6 6 6" />
                      ) : (
                        <path d="M6 9l6 6 6-6" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
              {collapsedWidgets.catlink ? null : !status?.catlinkConfigured ? (
                <div className="mt-3 space-y-3">
                  <p className="text-base text-slate-300 sm:text-lg">
                    FamilyBoard uses CatLink&apos;s password API (same as Home Assistant). SMS
                    codes from the app cannot be used here.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400 sm:text-base">
                    <li>In the CatLink app: Account → Security → set a short password (8–12 letters/numbers).</li>
                    <li>Log out, then log back in with phone + password (not SMS) to confirm it works.</li>
                    <li>Log out again, then link below (CatLink allows only one active session).</li>
                  </ol>
                  <div className="space-y-2">
                    <input
                      type="tel"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-sky-500"
                      placeholder="Phone (4244420566 or +1 424 442 0566)"
                      aria-label="Catlink phone number"
                      value={catlinkLinkPhone}
                      onChange={(e) => setCatlinkLinkPhone(e.currentTarget.value)}
                    />
                    <input
                      type="password"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-sky-500"
                      placeholder="CatLink app password"
                      aria-label="Catlink password"
                      value={catlinkLinkPassword}
                      onChange={(e) => setCatlinkLinkPassword(e.currentTarget.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy === "catlink-link"}
                    className="inline-flex rounded-full bg-sky-500 px-4 py-2 text-base font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 sm:text-lg"
                    onClick={() => void linkCatlink()}
                  >
                    {busy === "catlink-link" ? "Linking…" : "Link Catlink"}
                  </button>
                  <p className="text-xs text-slate-500 sm:text-sm">
                    Or set{" "}
                    <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                      CATLINK_PHONE
                    </code>{" "}
                    and{" "}
                    <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                      CATLINK_PASSWORD
                    </code>{" "}
                    in env for automatic login.
                  </p>
                </div>
              ) : catlink ? (
                <div className="mt-3 space-y-3">
                  {catlinkCatName ? (
                    <p className="text-sm text-slate-400 sm:text-base">{catlinkCatName}</p>
                  ) : null}
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm sm:text-base ${
                      catlinkWasteBinFull
                        ? "border-amber-500/60 bg-amber-500/15"
                        : "border-slate-800 bg-slate-950/40"
                    }`}
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">Waste bin</p>
                    <p
                      className={`mt-1 font-medium ${
                        catlinkWasteBinFull ? "text-amber-200" : "text-slate-100"
                      }`}
                    >
                      {catlinkWasteBinStatusLabel ?? "—"}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm sm:text-base">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Weight</p>
                      <p className="mt-1 font-medium tabular-nums text-slate-100">
                        {catlinkCatWeightKg !== null
                          ? `${catlinkCatWeightKg.toFixed(1)} kg`
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Pee</p>
                      <p className="mt-1 font-medium tabular-nums text-slate-100">
                        {catlinkPeeToday !== null ? catlinkPeeToday : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Poop</p>
                      <p className="mt-1 font-medium tabular-nums text-slate-100">
                        {catlinkPoopToday !== null ? catlinkPoopToday : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-2.5 py-2 text-sm text-slate-100 hover:border-slate-500 disabled:opacity-50"
                      disabled={busy === "catlink-clean_now"}
                      onClick={() => void catlinkControl("clean_now")}
                    >
                      {busy === "catlink-clean_now" ? "Working…" : "Clean"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-2.5 py-2 text-sm text-slate-100 hover:border-slate-500 disabled:opacity-50"
                      disabled={busy === "catlink-refill_litter"}
                      onClick={() => void catlinkControl("refill_litter")}
                    >
                      {busy === "catlink-refill_litter" ? "Working…" : "Refill"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-2.5 py-2 text-sm text-slate-100 hover:border-slate-500 disabled:opacity-50"
                      disabled={busy === "catlink-change_bag"}
                      onClick={() => void catlinkControl("change_bag")}
                    >
                      {busy === "catlink-change_bag" ? "Working…" : "Change bag"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-2.5 py-2 text-sm text-slate-100 hover:border-slate-500 disabled:opacity-50"
                      disabled={busy === "catlink-reset_bin"}
                      onClick={() => void catlinkControl("reset_bin")}
                    >
                      {busy === "catlink-reset_bin" ? "Working…" : "Reset"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">Loading catlink…</p>
              )}
            </section>

            <section
              className={`min-w-0 shrink-0 overflow-hidden rounded-xl border p-3 shadow-lg transition-colors duration-500 sm:rounded-2xl sm:p-4 ${
                spotifyIsPlaying
                  ? "border-[#1db954]/50 bg-[#1db954]/30 shadow-[#1db954]/20"
                  : "border-slate-800 bg-slate-900/60 shadow-slate-950/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.spotify ? (
                    <SpotifyAlbumTitleIcon coverUrl={spotifyCover} />
                  ) : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Spotify</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => void fetchBoard()}
                    aria-label="Refresh spotify"
                    title="Refresh spotify"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  {status?.spotifyConfigured && status.spotifyLinked ? (
                    <button
                      type="button"
                      disabled={busy === "spotify-disconnect"}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-rose-200 disabled:opacity-50"
                      onClick={() => void disconnectSpotify()}
                      aria-label="Log out of Spotify"
                      title="Log out"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={`h-5 w-5 ${busy === "spotify-disconnect" ? "animate-pulse" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => toggleWidgetCollapse("spotify")}
                    aria-label={collapsedWidgets.spotify ? "Expand spotify" : "Collapse spotify"}
                    title={collapsedWidgets.spotify ? "Expand spotify" : "Collapse spotify"}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {collapsedWidgets.spotify ? (
                        <path d="M6 15l6-6 6 6" />
                      ) : (
                        <path d="M6 9l6 6 6-6" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
              {collapsedWidgets.spotify ? null : !status?.spotifyConfigured ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    SPOTIFY_CLIENT_ID
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    SPOTIFY_CLIENT_SECRET
                  </code>
                  .
                </p>
              ) : !status.spotifyLinked ? (
                <div className="mt-3 space-y-3">
                  <p className="text-base text-slate-300 sm:text-lg">
                    Link Spotify to show now-playing and control playback.
                  </p>
                  <a
                    className="inline-flex rounded-full bg-green-500 px-4 py-2 text-base font-medium text-slate-950 hover:bg-green-400 sm:text-lg"
                    href="/api/auth/spotify"
                  >
                    Link Spotify
                  </a>
                </div>
              ) : (
                <div className="mt-3 min-w-0 space-y-3 overflow-hidden">
                  {spotifyNotice ? (
                    <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 sm:text-base">
                      {spotifyNotice}
                    </p>
                  ) : null}
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="min-h-[6.75rem] rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          {spotifyCover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={spotifyCover}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-md object-cover"
                            />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded-md border border-slate-700 bg-slate-900/70" />
                          )}
                          <div className="min-w-0 flex-1">
                            {spotifyTrack ? (
                              <>
                                <p className="truncate text-base font-semibold text-white sm:text-lg">
                                  {spotifyTrack.name ?? "Unknown track"}
                                </p>
                                <p className="truncate text-sm text-slate-400 sm:text-base">
                                  {spotifyArtist || "Unknown artist"}
                                </p>
                                <p className="truncate text-xs uppercase tracking-wide text-slate-500 sm:text-sm">
                                  {spotifyTrack.album?.name ?? "Unknown album"}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="truncate text-base font-semibold text-slate-300 sm:text-lg">
                                  Nothing is currently playing
                                </p>
                                <p className="truncate text-sm text-slate-500 sm:text-base">
                                  Pick something from Search to start music.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                        {spotifyTrack && spotifyDurationMs > 0 ? (
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
                            <span className="w-10 shrink-0 text-right tabular-nums">
                              {formatMsClock(spotifyProgressMs)}
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={spotifyDurationMs}
                              step={1000}
                              value={spotifyProgressMs}
                              className="min-w-0 flex-1 accent-sky-500"
                              onChange={(e) =>
                                setSpotifySeekDraft(Number(e.currentTarget.value))
                              }
                              onMouseUp={() => void commitSpotifySeek()}
                              onTouchEnd={() => void commitSpotifySeek()}
                            />
                            <span className="w-10 shrink-0 tabular-nums">
                              {formatMsClock(spotifyDurationMs)}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-2 h-[1.125rem]" aria-hidden />
                        )}
                      </div>

                      <div className="flex min-w-0 items-center gap-2">
                        <select
                          className="max-w-full min-w-0 flex-1 truncate rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white outline-none focus:border-sky-500 sm:px-3 sm:text-base"
                          aria-label="Playback device"
                          value={spotifyEffectiveDeviceId}
                          onChange={(e) => {
                            const nextDeviceId = e.target.value;
                            if (
                              nextDeviceId === spotifySdkDeviceId ||
                              spotifyLiveDeviceIds.has(nextDeviceId)
                            ) {
                              setSpotifySelectedDeviceId(nextDeviceId);
                              void spotifyControl("set_device", { deviceId: nextDeviceId });
                            } else {
                              setSpotifyNotice(
                                "Selected device is last seen only. Open Spotify on that device first, then refresh devices.",
                              );
                            }
                          }}
                        >
                          {spotifySdkDeviceId && !spotifySdkInDeviceList ? (
                            <option value={spotifySdkDeviceId}>
                              FamilyBoard Web Player{" "}
                              {spotifyActiveDevice?.id === spotifySdkDeviceId ? "• active" : ""}
                            </option>
                          ) : null}
                          {spotifyDeviceOptions.length === 0 ? (
                            <option value="">No devices found</option>
                          ) : (
                            spotifyDeviceOptions.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name ?? "Unknown"}{" "}
                                {d.is_active
                                  ? "• active"
                                  : spotifyDevices.some((live) => live.id === d.id)
                                    ? ""
                                    : "• last seen"}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          disabled={busy === "spotify-refresh-devices"}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-600 text-slate-100 hover:border-slate-400 disabled:opacity-50"
                          onClick={() => void refreshSpotifyDevices()}
                          aria-label="Refresh devices"
                          title="Refresh devices"
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className={`h-4 w-4 ${busy === "spotify-refresh-devices" ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                            <path d="M21 3v6h-6" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy === "spotify-previous"}
                            className="rounded-full border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:border-slate-400 disabled:opacity-50 sm:text-base"
                            onClick={() => void spotifyControl("previous")}
                          >
                            Prev
                          </button>
                          {spotifyPlayback?.is_playing ? (
                            <button
                              type="button"
                              disabled={busy === "spotify-pause"}
                              className="rounded-full bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:text-base"
                              onClick={() => void spotifyControl("pause")}
                            >
                              Pause
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy === "spotify-play"}
                              className="rounded-full bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:text-base"
                              onClick={() =>
                                void spotifyControl("play", {
                                  deviceId: spotifyEffectiveDeviceId || undefined,
                                })
                              }
                            >
                              Play
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy === "spotify-next"}
                            className="rounded-full border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:border-slate-400 disabled:opacity-50 sm:text-base"
                            onClick={() => void spotifyControl("next")}
                          >
                            Next
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-600 p-2 text-slate-100 hover:border-slate-400"
                            onClick={() => setSpotifyPickOpen(true)}
                            aria-label="Search music"
                            title="Search music"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="11" cy="11" r="7" />
                              <path d="M20 20l-3.5-3.5" />
                            </svg>
                          </button>
                      </div>
                    </div>
                    <div
                      className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5 self-start rounded-lg border border-slate-800 bg-slate-950/35 px-2 pb-2 pt-2.5"
                      aria-label="Volume"
                    >
                      <button
                        type="button"
                        disabled={
                          !spotifyActiveDevice ||
                          spotifyVolumeBusy ||
                          spotifyVolumeDisplay >= 100
                        }
                        className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-600 text-3xl leading-none text-slate-100 hover:border-sky-500 hover:bg-slate-800/80 disabled:opacity-40 sm:h-14 sm:w-14"
                        aria-label="Volume up"
                        onClick={() => void adjustSpotifyVolume(SPOTIFY_VOLUME_STEP)}
                      >
                        +
                      </button>
                      <span
                        className={`min-h-[2.25rem] tabular-nums text-2xl font-semibold leading-none transition-colors sm:text-3xl ${
                          spotifyVolumeIsPending ? "text-slate-500" : "text-white"
                        }`}
                      >
                        {spotifyVolumeDisplay}
                      </span>
                      <button
                        type="button"
                        disabled={
                          !spotifyActiveDevice ||
                          spotifyVolumeBusy ||
                          spotifyVolumeDisplay <= 0
                        }
                        className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-600 text-3xl leading-none text-slate-100 hover:border-sky-500 hover:bg-slate-800/80 disabled:opacity-40 sm:h-14 sm:w-14"
                        aria-label="Volume down"
                        onClick={() => void adjustSpotifyVolume(-SPOTIFY_VOLUME_STEP)}
                      >
                        −
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.hue ? <HueBulbTitleIcon on={hueAnyOn} /> : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Hue</h2>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => void fetchBoard()}
                    aria-label="Refresh hue"
                    title="Refresh hue"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => toggleWidgetCollapse("hue")}
                    aria-label={collapsedWidgets.hue ? "Expand hue" : "Collapse hue"}
                    title={collapsedWidgets.hue ? "Expand hue" : "Collapse hue"}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {collapsedWidgets.hue ? (
                        <path d="M6 15l6-6 6 6" />
                      ) : (
                        <path d="M6 9l6 6 6-6" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
              {collapsedWidgets.hue ? null : !status?.hueBridgeIp ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    HUE_BRIDGE_IP
                  </code>{" "}
                  on the server.
                </p>
              ) : !status.huePaired ? (
                <div className="mt-3 space-y-3 text-base text-slate-300 sm:text-lg">
                  <p>
                    Press the{" "}
                    <span className="font-medium text-white">link</span> button on
                    the bridge, then pair within about 30 seconds.
                  </p>
                  <button
                    type="button"
                    disabled={busy === "pair"}
                    onClick={() => void pairHue()}
                    className="w-full rounded-full bg-amber-500 px-4 py-2.5 text-base font-medium text-slate-950 hover:bg-amber-400 disabled:opacity-50 sm:text-lg"
                  >
                    {busy === "pair" ? "Pairing…" : "Pair bridge"}
                  </button>
                </div>
              ) : areas.length === 0 ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  No rooms or zones found.
                </p>
              ) : (
                <div className="mt-2.5 space-y-2.5">
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {pinnedHueAreas.map((area) => (
                      <li
                        key={area.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/30 px-2.5 py-1.5"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-xs font-medium text-slate-200 sm:text-sm">
                            {area.name}
                          </p>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
                            {area.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-sky-500 sm:text-sm"
                            value={hueThemeByArea[area.id] ?? "relax"}
                            onChange={(e) => {
                              const theme = e.target.value as HueThemeKey;
                              setHueThemeByArea((prev) => ({
                                ...prev,
                                [area.id]: theme,
                              }));
                              void applyHueTheme(area.id, theme);
                            }}
                            disabled={busy === `hue-theme-${area.id}`}
                          >
                            {HUE_THEME_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={busy === `hue-${area.id}`}
                            onClick={() => void toggleArea(area.id, !area.on)}
                            className={`rounded-full px-3 py-1.5 text-sm font-semibold sm:text-base ${
                              area.on
                                ? "bg-amber-300 text-slate-900"
                                : "bg-slate-800 text-slate-200"
                            } disabled:opacity-40`}
                          >
                            {area.on ? "On" : "Off"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {otherHueAreas.length > 0 ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/20">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-300 hover:text-white sm:text-base"
                        onClick={() => setShowOtherHueAreas((v) => !v)}
                      >
                        <span>Other rooms and zones ({otherHueAreas.length})</span>
                        <span className="text-xs text-slate-500">
                          {showOtherHueAreas ? "Hide" : "Show"}
                        </span>
                      </button>
                      {showOtherHueAreas ? (
                        <ul className="grid grid-cols-1 gap-1.5 border-t border-slate-800 p-2 sm:grid-cols-2">
                          {otherHueAreas.map((area) => (
                            <li
                              key={area.id}
                              className="rounded-lg border border-slate-800 bg-slate-950/30 px-2.5 py-1.5"
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="min-w-0 truncate text-xs font-medium text-slate-200 sm:text-sm">
                                  {area.name}
                                </p>
                                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
                                  {area.type}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-sky-500 sm:text-sm"
                                  value={hueThemeByArea[area.id] ?? "relax"}
                                  onChange={(e) => {
                                    const theme = e.target.value as HueThemeKey;
                                    setHueThemeByArea((prev) => ({
                                      ...prev,
                                      [area.id]: theme,
                                    }));
                                    void applyHueTheme(area.id, theme);
                                  }}
                                  disabled={busy === `hue-theme-${area.id}`}
                                >
                                  {HUE_THEME_OPTIONS.map((opt) => (
                                    <option key={opt.key} value={opt.key}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={busy === `hue-${area.id}`}
                                  onClick={() => void toggleArea(area.id, !area.on)}
                                  className={`rounded-full px-3 py-1.5 text-sm font-semibold sm:text-base ${
                                    area.on
                                      ? "bg-amber-300 text-slate-900"
                                      : "bg-slate-800 text-slate-200"
                                  } disabled:opacity-40`}
                                >
                                  {area.on ? "On" : "Off"}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {pinnedHueAreas.length === 0 ? (
                    <p className="text-xs text-slate-500 sm:text-sm">
                      Pinned rooms (TV, Living Room, Caro, Office) are not available on this bridge.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {collapsedWidgets.nest ? (
                    <IndoorTempTitleIcon tempF={indoorTitleTempF} />
                  ) : null}
                  <h2 className="truncate text-xl font-medium text-white sm:text-2xl">Indoor</h2>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => void fetchBoard()}
                    aria-label="Refresh indoor climate"
                    title="Refresh indoor climate"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                    onClick={() => toggleWidgetCollapse("nest")}
                    aria-label={collapsedWidgets.nest ? "Expand indoor" : "Collapse indoor"}
                    title={collapsedWidgets.nest ? "Expand indoor" : "Collapse indoor"}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {collapsedWidgets.nest ? (
                        <path d="M6 15l6-6 6 6" />
                      ) : (
                        <path d="M6 9l6 6 6-6" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
              {collapsedWidgets.nest ? null : !status?.googleConfigured ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    GOOGLE_CLIENT_ID
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    GOOGLE_CLIENT_SECRET
                  </code>
                  .
                </p>
              ) : !status.googleLinked ? (
                <div className="mt-3 space-y-3">
                  <p className="text-base text-slate-300 sm:text-lg">
                    Link Google to read Nest indoor climate.
                  </p>
                  <a
                    className="inline-flex rounded-full bg-white px-4 py-2 text-base font-medium text-slate-900 hover:bg-slate-100 sm:text-lg"
                    href="/api/auth/google"
                  >
                    Link Google
                  </a>
                </div>
              ) : !status.nestConfigured ? (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    GOOGLE_NEST_PROJECT_ID
                  </code>{" "}
                  to enable Nest indoor readings.
                </p>
              ) : indoorClimate?.hasData ? (
                <div className="mt-3">
                  <IndoorClimateCharts history={indoorClimate.history ?? []} />
                </div>
              ) : indoorClimate?.error ? (
                <div className="mt-3 space-y-2">
                  <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 sm:text-base">
                    {indoorClimate.error}
                  </p>
                  <a
                    className="inline-flex rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 sm:text-base"
                    href="/api/auth/nest/pcm"
                  >
                    Authorize Nest devices
                  </a>
                  {indoorClimate.history && indoorClimate.history.length > 0 ? (
                    <IndoorClimateCharts history={indoorClimate.history} />
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">Loading indoor climate…</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {newEventOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-xl font-semibold text-white sm:text-2xl">New event</h3>
            <p className="mt-1 text-sm text-slate-400 sm:text-base">
              Calendar:{" "}
              {calendars.find((c) => c.id === selectedCalendarId)?.summary ??
                selectedCalendarId}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                Title
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="Event title"
                  autoFocus
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-base text-slate-200 sm:text-lg">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 rounded border-slate-600 bg-slate-900 accent-sky-500"
                  checked={newAllDay}
                  onChange={(e) => onNewAllDayChange(e.target.checked)}
                />
                <span>All-day event</span>
              </label>
              <EventDateTimePicker
                label={newAllDay ? "Start date" : "Start"}
                value={newTimes.start}
                allDay={newAllDay}
                onChange={(start) => setNewTimes((t) => ({ ...t, start }))}
              />
              <EventDateTimePicker
                label={newAllDay ? "End date (inclusive)" : "End"}
                value={newTimes.end}
                allDay={newAllDay}
                min={newTimes.start}
                onChange={(end) => setNewTimes((t) => ({ ...t, end }))}
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-slate-800 px-4 py-2.5 text-base text-white hover:bg-slate-700 sm:text-lg"
                onClick={() => setNewEventOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "add"}
                className="rounded-full bg-sky-600 px-4 py-2.5 text-base font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:text-lg"
                onClick={() => void addEvent()}
              >
                {busy === "add" ? "Saving…" : "Create event"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-xl font-semibold text-white sm:text-2xl">Edit event</h3>
            {editAllDay ? (
              <p className="mt-1 text-sm text-slate-400 sm:text-base">All-day</p>
            ) : null}
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                Title
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </label>
              <EventDateTimePicker
                label={editAllDay ? "Start date" : "Start"}
                value={editStart}
                allDay={editAllDay}
                onChange={setEditStart}
              />
              <EventDateTimePicker
                label={editAllDay ? "End date (inclusive)" : "End"}
                value={editEnd}
                allDay={editAllDay}
                min={editStart}
                onChange={setEditEnd}
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-slate-800 px-4 py-2.5 text-base text-white hover:bg-slate-700 sm:text-lg"
                onClick={() => {
                  setEditOpen(null);
                  setEditAllDay(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "save"}
                className="rounded-full bg-sky-600 px-4 py-2.5 text-base font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:text-lg"
                onClick={() => void saveEdit()}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy === "delete"}
                className="rounded-full bg-rose-700 px-4 py-2.5 text-base font-medium text-white hover:bg-rose-600 disabled:opacity-50 sm:text-lg"
                onClick={() => void deleteEdit()}
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {spotifyPickOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
          onClick={() => setSpotifyPickOpen(false)}
          role="presentation"
        >
          <div
            className="flex h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-950 shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="spotify-picker-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <h3
                id="spotify-picker-title"
                className="text-lg font-semibold tracking-tight text-white sm:text-xl"
              >
                Search music
              </h3>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close search"
                onClick={() => setSpotifyPickOpen(false)}
              >
                <span className="block text-xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>

            <div className="shrink-0 px-4 pb-2 pt-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/90 px-4 py-2.5 shadow-inner shadow-black/20">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5 shrink-0 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  ref={spotifyPickInputRef}
                  className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500 sm:text-lg"
                  placeholder="What do you want to play?"
                  value={spotifyQuery}
                  onChange={(e) => setSpotifyQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void searchSpotify();
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 sm:text-sm"
                  onClick={() => void searchSpotify()}
                >
                  Search
                </button>
                {spotifySearching ? (
                  <span className="shrink-0 text-xs font-medium text-sky-400 sm:text-sm">
                    Searching…
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-500 sm:text-sm">
                Search playlists, albums, and songs. Results update as you type.
              </p>
            </div>

            <div className="shrink-0 border-b border-slate-800 px-3 pb-2">
              <div className="flex gap-1 overflow-x-auto pb-1">
                {(["recent", "featured", "results"] as const).map((tab) => {
                  const count =
                    tab === "recent"
                      ? spotifyRecentItems.length
                      : tab === "featured"
                        ? spotifyFeaturedPlaylists.length
                        : spotifySearchResults.tracks.length +
                          spotifySearchResults.albums.length +
                          spotifySearchResults.playlists.length;
                  const label =
                    tab === "recent"
                      ? "Recent"
                      : tab === "featured"
                        ? "Featured"
                        : "Results";
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold sm:text-sm ${
                        spotifyResultTab === tab
                          ? "bg-white text-slate-950"
                          : "border border-slate-700 text-slate-300 hover:border-slate-500"
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSpotifyResultTab(tab);
                      }}
                    >
                      {label}
                      {tab === "results" && spotifyQuery.trim().length > 0 ? (
                        <span className="ml-1 tabular-nums opacity-70">{count}</span>
                      ) : tab !== "results" ? (
                        <span className="ml-1 tabular-nums opacity-70">{count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="board-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {spotifyResultTab === "results" && spotifyQuery.trim().length < 1 ? (
                <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                  Start typing to search playlists, albums, and songs.
                </p>
              ) : spotifyResultTab === "recent" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs text-slate-500 sm:text-sm">
                      Source:{" "}
                      <span className="font-medium text-slate-300">
                        {spotifyRecentSource === "account" ? "Spotify account" : "FamilyBoard local"}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500"
                      onClick={() => void refreshSpotifyAccountRecent()}
                    >
                      Refresh recent
                    </button>
                  </div>
                  {spotifyRecentError ? (
                    <p className="rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200">
                      {spotifyRecentError}
                    </p>
                  ) : null}
                  {spotifyRecentItems.length === 0 ? (
                    <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                      Nothing recent yet.
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {spotifyRecentItems.map((item) => (
                        <li
                          key={`rp-${item.kind}-${item.id}`}
                          className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5"
                        >
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-md object-cover shadow-md"
                            />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-medium text-white sm:text-lg">
                              {item.name}
                            </p>
                            <p className="truncate text-sm text-slate-400">{item.subtitle}</p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
                            onClick={() => {
                              if (item.kind === "track") {
                                void spotifyControl("play_track", {
                                  uri: item.uri,
                                  deviceId: spotifyEffectiveDeviceId || undefined,
                                });
                                return;
                              }
                              void spotifyControl("play_context", {
                                uri: item.uri,
                                deviceId: spotifyEffectiveDeviceId || undefined,
                              });
                            }}
                          >
                            Play
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : spotifyResultTab === "featured" ? (
                spotifyFeaturedLoading ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    Loading featured playlists…
                  </p>
                ) : spotifyFeaturedError ? (
                  <div className="space-y-3">
                    <p className="rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200">
                      {spotifyFeaturedError}
                    </p>
                    <button
                      type="button"
                      className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
                      onClick={() => void refreshSpotifyFeatured()}
                    >
                      Retry
                    </button>
                  </div>
                ) : spotifyFeaturedPlaylists.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    No featured playlists right now.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {spotifyFeaturedPlaylists.slice(0, 20).map((p) => (
                      <li
                        key={`fp-${p.id ?? p.uri ?? p.name}`}
                        className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 hover:bg-slate-900/80"
                      >
                        {p.images?.[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.images[0].url}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-md object-cover shadow-md"
                          />
                        ) : (
                          <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium text-white sm:text-lg">
                            {p.name ?? "Unknown playlist"}
                          </p>
                          <p className="truncate text-sm text-slate-400">
                            Featured playlist
                            {p.owner?.display_name ? ` · by ${p.owner.display_name}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void spotifyControl("play_context", {
                              uri: spotifyContextUri("playlist", p.id, p.uri),
                              deviceId: spotifyEffectiveDeviceId || undefined,
                            });
                            addSpotifyRecentItem({
                              kind: "playlist",
                              id: p.id ?? p.uri ?? p.name ?? String(Date.now()),
                              name: p.name ?? "Unknown playlist",
                              subtitle: `Featured playlist${p.owner?.display_name ? ` · by ${p.owner.display_name}` : ""}`,
                              imageUrl: p.images?.[0]?.url,
                              uri: spotifyContextUri("playlist", p.id, p.uri),
                            });
                          }}
                        >
                          Play
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : spotifyResultTab === "results" ? (
                spotifySearching ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    Searching…
                  </p>
                ) : spotifySearchResults.tracks.length === 0 &&
                  spotifySearchResults.albums.length === 0 &&
                  spotifySearchResults.playlists.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    No playlists, albums, or songs found.
                  </p>
                ) : (
                  <div className="space-y-5">
                    {spotifySearchResults.playlists.length > 0 ? (
                      <section>
                        <h4 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:text-sm">
                          Playlists
                        </h4>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {spotifySearchResults.playlists.map((p) => (
                            <li
                              key={`pp-${p.id}`}
                              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 hover:bg-slate-900/80"
                            >
                              {p.images?.[0]?.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.images[0].url}
                                  alt=""
                                  className="h-14 w-14 shrink-0 rounded-md object-cover shadow-md"
                                />
                              ) : (
                                <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-base font-medium text-white sm:text-lg">
                                  {p.name ?? "Unknown playlist"}
                                </p>
                                <p className="truncate text-sm text-slate-400">
                                  by {p.owner?.display_name ?? "Unknown"}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="shrink-0 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 sm:text-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void (async () => {
                                    const ok = await spotifyControl("play_context", {
                                      uri: spotifyContextUri("playlist", p.id, p.uri),
                                      deviceId: spotifyEffectiveDeviceId || undefined,
                                    });
                                    if (ok) {
                                      addSpotifyRecentItem({
                                        kind: "playlist",
                                        id: p.id ?? p.uri ?? p.name ?? String(Date.now()),
                                        name: p.name ?? "Unknown playlist",
                                        subtitle: `Playlist · by ${p.owner?.display_name ?? "Unknown"}`,
                                        imageUrl: p.images?.[0]?.url,
                                        uri: spotifyContextUri("playlist", p.id, p.uri),
                                      });
                                      setSpotifyPickOpen(false);
                                    }
                                  })();
                                }}
                              >
                                Play
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {spotifySearchResults.albums.length > 0 ? (
                      <section>
                        <h4 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:text-sm">
                          Albums
                        </h4>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {spotifySearchResults.albums.map((a) => (
                            <li
                              key={`ap-${a.id}`}
                              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 hover:bg-slate-900/80"
                            >
                              {a.images?.[0]?.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.images[0].url}
                                  alt=""
                                  className="h-14 w-14 shrink-0 rounded-md object-cover shadow-md"
                                />
                              ) : (
                                <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-base font-medium text-white sm:text-lg">
                                  {a.name ?? "Unknown album"}
                                </p>
                                <p className="truncate text-sm text-slate-400">
                                  {a.artists
                                    ?.map((x) => x.name)
                                    .filter(Boolean)
                                    .join(", ") ?? "Unknown artist"}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="shrink-0 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 sm:text-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void (async () => {
                                    const ok = await spotifyControl("play_context", {
                                      uri: spotifyContextUri("album", a.id, a.uri),
                                      deviceId: spotifyEffectiveDeviceId || undefined,
                                    });
                                    if (ok) {
                                      addSpotifyRecentItem({
                                        kind: "album",
                                        id: a.id ?? a.uri ?? a.name ?? String(Date.now()),
                                        name: a.name ?? "Unknown album",
                                        subtitle: `Album · ${
                                          a.artists
                                            ?.map((x) => x.name)
                                            .filter(Boolean)
                                            .join(", ") ?? "Unknown artist"
                                        }`,
                                        imageUrl: a.images?.[0]?.url,
                                        uri: spotifyContextUri("album", a.id, a.uri),
                                      });
                                      setSpotifyPickOpen(false);
                                    }
                                  })();
                                }}
                              >
                                Play
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {spotifySearchResults.tracks.length > 0 ? (
                      <section>
                        <h4 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:text-sm">
                          Songs
                        </h4>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {spotifySearchResults.tracks.map((t) => (
                      <li
                        key={`tp-${t.id}`}
                        className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5"
                      >
                        {t.album?.images?.[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.album.images[0].url}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-md object-cover shadow-md"
                          />
                        ) : (
                          <div className="h-14 w-14 shrink-0 rounded-md border border-slate-800 bg-slate-900" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium text-white sm:text-lg">
                            {t.name ?? "Unknown track"}
                          </p>
                          <p className="truncate text-sm text-slate-400">
                            {t.artists
                              ?.map((a) => a.name)
                              .filter(Boolean)
                              .join(", ") ?? "Unknown artist"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded-full p-2.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                            aria-label="Add to queue"
                            title="Add to queue"
                            onClick={() =>
                              void spotifyControl("queue_track", {
                                uri: t.uri,
                                deviceId: spotifyEffectiveDeviceId || undefined,
                              })
                            }
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 12h10M12 5v14" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg hover:bg-emerald-400"
                            aria-label="Play"
                            title="Play"
                            onClick={() =>
                              void (async () => {
                                const ok = await spotifyControl("play_track", {
                                  uri: t.uri,
                                  deviceId: spotifyEffectiveDeviceId || undefined,
                                });
                                if (ok) {
                                  addSpotifyRecentItem({
                                    kind: "track",
                                    id: t.id ?? t.uri ?? t.name ?? String(Date.now()),
                                    name: t.name ?? "Unknown track",
                                    subtitle:
                                      t.artists
                                        ?.map((a) => a.name)
                                        .filter(Boolean)
                                        .join(", ") ?? "Unknown artist",
                                    imageUrl: t.album?.images?.[0]?.url,
                                    uri: t.uri,
                                  });
                                  setSpotifyPickOpen(false);
                                }
                              })()
                            }
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              className="ml-0.5 h-5 w-5"
                              fill="currentColor"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
    <OnekoCat enabled />
    </>
  );
}
