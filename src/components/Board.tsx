"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CompactCalendarGrid } from "@/components/calendar/CompactCalendarGrid";
import {
  addDays,
  dateKeyLocal,
  DEFAULT_HOME_CALENDAR_WEEKS,
  defaultCalendarRangeKeys,
  enumerateWeekStarts,
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
import { WeatherIcon } from "@/components/WeatherIcon";

type HueArea = {
  id: string;
  name: string;
  on: boolean;
  type: string;
};

type Status = {
  googleLinked: boolean;
  googleConfigured: boolean;
  spotifyLinked: boolean;
  spotifyConfigured: boolean;
  hueReady: boolean;
  hueBridgeIp: string | null;
  huePaired: boolean;
  weatherConfigured: boolean;
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

type RightWidgetKey = "clock" | "weather" | "hue" | "spotify";
type SpotifyResultTab = "recent" | "tracks" | "albums" | "playlists";

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

function toInputValue(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialNewEventRange() {
  const s = new Date();
  s.setMinutes(Math.ceil(s.getMinutes() / 15) * 15, 0, 0);
  const e = new Date(s.getTime() + 60 * 60 * 1000);
  return { start: toInputValue(s.toISOString()), end: toInputValue(e.toISOString()) };
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

function shortWeekdayFromForecastDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short" });
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

function mergeSpotifyDevices(
  primary: SpotifyDevice[],
  secondary: SpotifyDevice[],
): SpotifyDevice[] {
  const byId = new Map<string, SpotifyDevice>();
  const byName = new Map<string, SpotifyDevice>();
  for (const d of [...primary, ...secondary]) {
    const id = (d.id ?? "").trim();
    const name = (d.name ?? "").trim().toLowerCase();
    if (id && !byId.has(id)) {
      byId.set(id, d);
      continue;
    }
    if (!id && name && !byName.has(name)) {
      byName.set(name, d);
    }
  }
  return [...byId.values(), ...byName.values()];
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
  const [weather, setWeather] = useState<Record<string, unknown> | null>(null);
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

  const [newSummary, setNewSummary] = useState("Family dinner");
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
    hue: false,
    spotify: false,
  });

  const [nightGreyscale, setNightGreyscale] = useState(false);
  useEffect(() => {
    function tickNight() {
      const h = new Date().getHours();
      setNightGreyscale(h >= 22 || h < 7);
    }
    tickNight();
    const nid = window.setInterval(tickNight, 60_000);
    return () => window.clearInterval(nid);
  }, []);

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
        const hRes = await fetch("/api/hue/areas", { signal });
        if (signal?.aborted) return;
        if (hRes.status === 501) {
          setAreas([]);
        } else if (hRes.ok) {
          const data = (await hRes.json()) as { areas: HueArea[] };
          setAreas(data.areas ?? []);
        }
      } else {
        setAreas([]);
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

  function openNewEventModal() {
    setNewAllDay(false);
    setNewTimes(initialNewEventRange());
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

  async function commitSpotifySeek() {
    if (spotifySeekDraft === null) return;
    const duration = Number(spotifyTrack?.duration_ms ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const clamped = Math.max(0, Math.min(duration, Math.round(spotifySeekDraft)));
    await spotifyControl("seek", { positionMs: clamped });
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
        `/api/spotify/search?q=${encodeURIComponent(q)}&limit=10`,
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
      if (next.tracks.length > 0) setSpotifyResultTab("tracks");
      else if (next.albums.length > 0) setSpotifyResultTab("albums");
      else if (next.playlists.length > 0) setSpotifyResultTab("playlists");
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
  const daily = weather?.daily as
    | Array<{ date?: string; maxF?: number; minF?: number; code?: number }>
    | undefined;
  const hourlyToday = weather?.hourlyToday as
    | Array<{ time?: string; temperatureF?: number; code?: number }>
    | undefined;
  const todayForecast = daily?.[0];
  const spotifyTrack = spotifyPlayback?.item;
  const spotifyArtist = spotifyTrack?.artists?.map((a) => a.name).filter(Boolean).join(", ");
  const spotifyActiveDevice =
    spotifyDevices.find((d) => d.is_active) ?? spotifyPlayback?.device ?? null;
  const spotifyEffectiveDeviceId =
    spotifySelectedDeviceId || spotifyActiveDevice?.id || spotifySdkDeviceId || "";
  const spotifySdkInDeviceList = Boolean(
    spotifySdkDeviceId && spotifyDevices.some((d) => d.id === spotifySdkDeviceId),
  );
  const spotifyCover = spotifyTrack?.album?.images?.[0]?.url;
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
          label: `${fmt(start)}-${fmt(end)} ${ev.summary || "(No title)"}`,
          event: ev,
        };
      })
      .filter(
        (x): x is {
          kind: "timed";
          key: string;
          startMs: number;
          label: string;
          event: CalendarEvent;
        } => Boolean(x),
      )
      .sort((a, b) => a.startMs - b.startMs)
      .slice(0, 20);
  }, [todayEvents]);

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

        <div className="board-scrollbar grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden sm:gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-3 md:p-4">
            <div className="mb-3 flex min-w-0 shrink-0 items-center gap-3 rounded-xl border border-slate-500/70 bg-slate-500/90 px-4 py-3 shadow-md shadow-slate-950/30 sm:mb-4 sm:gap-4 sm:px-5 sm:py-3.5 md:py-4 md:shadow-lg">
              <span className="shrink-0 text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                Today 8am-8pm
              </span>
              <div className="board-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-0.5 text-base text-slate-900 sm:text-lg">
                {todayAllDayStrip.length === 0 && todayTimedStrip.length === 0 ? (
                  <span className="text-slate-800 sm:text-base">No events in this window.</span>
                ) : (
                  <>
                    {todayAllDayStrip.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openEdit(item.event)}
                        className="mr-2 inline-flex max-w-[15rem] items-center truncate rounded-full border border-violet-600/80 bg-violet-300/95 px-3 py-1.5 text-left text-sm font-medium text-violet-950 hover:border-violet-700 hover:bg-violet-300 sm:mr-3 sm:max-w-[20rem] sm:px-3.5 sm:py-2 sm:text-base"
                        title={item.summary}
                      >
                        {item.summary}
                      </button>
                    ))}
                    {todayTimedStrip.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openEdit(item.event)}
                        className="mr-2 inline-flex max-w-full items-center rounded-full border border-slate-600/90 bg-slate-200/95 px-3 py-1.5 text-left text-sm font-medium text-slate-900 shadow-sm hover:border-slate-700 hover:bg-slate-100 sm:mr-3 sm:px-3.5 sm:py-2 sm:text-base"
                        title={item.label}
                      >
                        {item.label}
                      </button>
                    ))}
                  </>
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
                        showCalendarSource={selectedCalendarId === "__all__"}
                        comfortable={calendarComfortable}
                        onSelectEvent={(ev) => openEdit(ev)}
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

          <div className="board-scrollbar flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto sm:gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Clock</h2>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
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
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <p className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
                    {clockTime}
                  </p>
                  <p className="truncate text-xs uppercase tracking-wide text-slate-400 sm:text-sm">
                    {clockDate}
                  </p>
                </div>
              ) : null}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Weather</h2>
                <div className="flex items-center gap-3">
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
                  {hourlyToday && hourlyToday.length > 0 ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-1 py-1.5 sm:px-2">
                      <div className="flex w-full flex-nowrap items-stretch justify-between gap-0.5">
                        {hourlyToday.slice(0, 8).map((h) => {
                          const d = new Date(h.time ?? "");
                          const label = Number.isNaN(d.getTime())
                            ? (h.time ?? "").slice(11, 16)
                            : d.toLocaleTimeString([], { hour: "numeric" });
                          return (
                            <div
                              key={h.time}
                              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center"
                            >
                              <span className="w-full truncate text-[10px] leading-tight text-slate-400">
                                {label}
                              </span>
                              <WeatherIcon
                                code={Number(h.code ?? 0)}
                                className="h-4 w-4 shrink-0"
                              />
                              <span className="w-full truncate text-[10px] font-medium leading-tight text-slate-200">
                                {Math.round(h.temperatureF ?? 0)}°
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {daily && daily.length > 0 ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-1 py-1.5 sm:px-2">
                      <div className="flex w-full flex-nowrap items-stretch justify-between gap-0.5">
                        {daily.slice(0, 7).map((d) => (
                          <div
                            key={d.date}
                            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center"
                          >
                            <span className="w-full truncate text-[10px] font-semibold uppercase leading-tight text-slate-400">
                              {shortWeekdayFromForecastDate(d.date ?? "")}
                            </span>
                            <WeatherIcon
                              code={Number(d.code ?? 0)}
                              className="h-4 w-4 shrink-0"
                            />
                            <span className="w-full truncate text-[10px] font-medium leading-tight text-slate-200">
                              {Math.round(d.minF ?? 0)}-{Math.round(d.maxF ?? 0)}°
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-base text-slate-400 sm:text-lg">Loading weather…</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Hue</h2>
                <div className="flex items-center gap-3">
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
                <h2 className="text-xl font-medium text-white sm:text-2xl">Spotify</h2>
                <div className="flex items-center gap-3">
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
                <div className="mt-3 space-y-3">
                  {spotifyNotice ? (
                    <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 sm:text-base">
                      {spotifyNotice}
                    </p>
                  ) : null}
                  {spotifyTrack ? (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
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
                          <p className="truncate text-base font-semibold text-white sm:text-lg">
                            {spotifyTrack.name ?? "Unknown track"}
                          </p>
                          <p className="truncate text-sm text-slate-400 sm:text-base">
                            {spotifyArtist || "Unknown artist"}
                          </p>
                          <p className="truncate text-xs uppercase tracking-wide text-slate-500 sm:text-sm">
                            {spotifyTrack.album?.name ?? "Unknown album"}
                          </p>
                        </div>
                      </div>
                      {spotifyDurationMs > 0 ? (
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
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-base text-slate-400 sm:text-lg">
                      Nothing is currently playing.
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
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

                    <label className="w-36 shrink-0 text-right text-xs font-medium uppercase tracking-wide text-slate-400 sm:w-44 sm:text-sm">
                      Vol {Math.round(spotifyActiveDevice?.volume_percent ?? 0)}%
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(spotifyActiveDevice?.volume_percent ?? 0)}
                        disabled={!spotifyActiveDevice}
                        className="mt-1 w-full accent-sky-500 disabled:opacity-40"
                        onChange={(e) =>
                          void spotifyControl("set_volume", {
                            volumePercent: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>

                  <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                    <div className="flex items-center gap-2">
                      <select
                        className="w-full min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                        value={spotifyEffectiveDeviceId}
                        onChange={(e) => {
                          setSpotifySelectedDeviceId(e.target.value);
                          void spotifyControl("set_device", { deviceId: e.target.value });
                        }}
                      >
                        {spotifySdkDeviceId && !spotifySdkInDeviceList ? (
                          <option value={spotifySdkDeviceId}>
                            FamilyBoard Web Player {spotifyActiveDevice?.id === spotifySdkDeviceId ? "• active" : ""}
                          </option>
                        ) : null}
                        {spotifyDevices.length === 0 ? (
                          <option value="">No devices found</option>
                        ) : (
                          spotifyDevices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name ?? "Unknown"} {d.is_active ? "• active" : ""}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={busy === "spotify-refresh-devices"}
                        className="shrink-0 rounded-full border border-slate-600 px-2.5 py-1 text-xs text-slate-100 hover:border-slate-400 disabled:opacity-50"
                        onClick={() => void refreshSpotifyDevices()}
                      >
                        {busy === "spotify-refresh-devices" ? "Refreshing..." : "Refresh devices"}
                      </button>
                    </div>
                  </label>
                  <button
                    type="button"
                    disabled={busy === "spotify-disconnect"}
                    className="rounded-full border border-rose-900/60 px-4 py-2 text-base text-rose-100 hover:border-rose-700 disabled:opacity-50 sm:text-lg"
                    onClick={() => void disconnectSpotify()}
                  >
                    Disconnect Spotify
                  </button>
                </div>
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
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                {newAllDay ? "Start date" : "Start"}
                <input
                  type={newAllDay ? "date" : "datetime-local"}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={newTimes.start}
                  onChange={(e) =>
                    setNewTimes((t) => ({ ...t, start: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                {newAllDay ? "End date (inclusive)" : "End"}
                <input
                  type={newAllDay ? "date" : "datetime-local"}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={newTimes.end}
                  onChange={(e) =>
                    setNewTimes((t) => ({ ...t, end: e.target.value }))
                  }
                />
              </label>
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
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                {editAllDay ? "Start date" : "Start"}
                <input
                  type={editAllDay ? "date" : "datetime-local"}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                {editAllDay ? "End date (inclusive)" : "End"}
                <input
                  type={editAllDay ? "date" : "datetime-local"}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                />
              </label>
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
                Type at least 1 character — results update as you type. Press Enter to search
                immediately.
              </p>
            </div>

            <div className="shrink-0 border-b border-slate-800 px-3 pb-2">
              <div className="flex gap-1 overflow-x-auto pb-1">
                {(["recent", "tracks", "albums", "playlists"] as const).map((tab) => {
                  const count =
                    tab === "recent"
                      ? spotifyRecentItems.length
                      : tab === "tracks"
                      ? spotifySearchResults.tracks.length
                      : tab === "albums"
                        ? spotifySearchResults.albums.length
                        : spotifySearchResults.playlists.length;
                  const label =
                    tab === "recent"
                      ? "Recent"
                      : tab === "tracks"
                        ? "Songs"
                        : tab === "albums"
                          ? "Albums"
                          : "Playlists";
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
                      <span className="ml-1 tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="board-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {spotifyResultTab !== "recent" && spotifyQuery.trim().length < 1 ? (
                <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                  Start typing to search Spotify.
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
                    <ul className="divide-y divide-slate-800/90">
                      {spotifyRecentItems.map((item) => (
                        <li key={`rp-${item.kind}-${item.id}`} className="flex items-center gap-3 py-3">
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
              ) : spotifyResultTab === "tracks" ? (
                spotifySearchResults.tracks.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    No songs found.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/90">
                    {spotifySearchResults.tracks.slice(0, 20).map((t) => (
                      <li key={`tp-${t.id}`} className="flex items-center gap-3 py-3">
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
                )
              ) : spotifyResultTab === "albums" ? (
                spotifySearchResults.albums.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                    No albums found.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/90">
                    {spotifySearchResults.albums.slice(0, 20).map((a) => (
                      <li
                        key={`ap-${a.id}`}
                        className="flex items-center gap-3 rounded-xl py-3 hover:bg-slate-900/80"
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
                              Album ·{" "}
                              {a.artists
                                ?.map((x) => x.name)
                                .filter(Boolean)
                                .join(", ") ?? "Unknown artist"}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void spotifyControl("play_context", {
                                uri: spotifyContextUri("album", a.id, a.uri),
                                deviceId: spotifyEffectiveDeviceId || undefined,
                              });
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
                            }}
                          >
                            Play
                          </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : spotifySearchResults.playlists.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-slate-500 sm:text-base">
                  No playlists found.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800/90">
                  {spotifySearchResults.playlists.slice(0, 20).map((p) => (
                    <li
                      key={`pp-${p.id}`}
                      className="flex items-center gap-3 rounded-xl py-3 hover:bg-slate-900/80"
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
                            Playlist · by {p.owner?.display_name ?? "Unknown"}
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
                              subtitle: `Playlist · by ${p.owner?.display_name ?? "Unknown"}`,
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
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
    <OnekoCat enabled />
    </>
  );
}
