"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarRangePickerModal } from "@/components/calendar/CalendarRangePickerModal";
import { CompactCalendarGrid } from "@/components/calendar/CompactCalendarGrid";
import {
  addDays,
  dateKeyLocal,
  defaultCalendarRangeKeys,
  enumerateWeekStarts,
  parseLocalDateKey,
  rangeKeysToIso,
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

type RightWidgetKey = "clock" | "weather" | "hue" | "spotify";
type SpotifyResultTab = "tracks" | "albums" | "playlists";

type CastContextLike = {
  setOptions: (opts: { receiverApplicationId: string; autoJoinPolicy: string }) => void;
  requestSession: () => Promise<void>;
  getCurrentSession?: () => { getCastDevice?: () => { friendlyName?: string } | undefined } | null;
  addEventListener: (eventType: string, handler: (evt: { sessionState?: string }) => void) => void;
  removeEventListener: (
    eventType: string,
    handler: (evt: { sessionState?: string }) => void,
  ) => void;
};

type CastFrameworkLike = {
  CastContext: { getInstance: () => CastContextLike };
  SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string };
  CastContextEventType: { SESSION_STATE_CHANGED: string };
};

type ChromeCastLike = { AutoJoinPolicy: { ORIGIN_SCOPED: string } };

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
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: SpotifyWebPlaybackSDK;
    cast?: { framework?: CastFrameworkLike };
    chrome?: { cast?: ChromeCastLike };
  }
}

function formatMsClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
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
  const [areas, setAreas] = useState<HueArea[]>([]);
  const [weather, setWeather] = useState<Record<string, unknown> | null>(null);
  const [spotifyPlayback, setSpotifyPlayback] = useState<SpotifyPlayback | null>(
    null,
  );
  const [spotifyDevices, setSpotifyDevices] = useState<SpotifyDevice[]>([]);
  const [spotifySeekDraft, setSpotifySeekDraft] = useState<number | null>(null);
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [spotifySearchResults, setSpotifySearchResults] = useState<{
    tracks: SpotifySearchTrack[];
    albums: SpotifySearchAlbum[];
    playlists: SpotifySearchPlaylist[];
  }>({ tracks: [], albums: [], playlists: [] });
  const [spotifyResultTab, setSpotifyResultTab] = useState<SpotifyResultTab>("tracks");
  const [spotifySdkReady, setSpotifySdkReady] = useState(false);
  const [spotifySdkDeviceId, setSpotifySdkDeviceId] = useState<string | null>(null);
  const [spotifySelectedDeviceId, setSpotifySelectedDeviceId] = useState<string>("");
  const [castReady, setCastReady] = useState(false);
  const [castSessionConnected, setCastSessionConnected] = useState(false);
  const [castWakeBaselineIds, setCastWakeBaselineIds] = useState<string[] | null>(null);
  const [castTargetName, setCastTargetName] = useState<string | null>(null);
  const [castSupportHint, setCastSupportHint] = useState<string | null>(null);
  const [spotifyNotice, setSpotifyNotice] = useState<string | null>(null);
  const castWakePollingRef = useRef<number | null>(null);
  const spotifyPlayerRef = useRef<SpotifyWebPlaybackPlayer | null>(null);
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
    defaultCalendarRangeKeys(4),
  );
  const fetchIso = useMemo(() => rangeKeysToIso(rangeKeys), [rangeKeys]);
  const weekStarts = useMemo(() => {
    const a = startOfDay(parseLocalDateKey(rangeKeys.fromKey));
    const b = startOfDay(parseLocalDateKey(rangeKeys.toInclusiveKey));
    return enumerateWeekStarts(a, b);
  }, [rangeKeys.fromKey, rangeKeys.toInclusiveKey]);

  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState(() => {
    const k = defaultCalendarRangeKeys(4);
    return { from: k.fromKey, to: k.toInclusiveKey };
  });
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("primary");

  const [clockNow, setClockNow] = useState(() => new Date());
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
      } else {
        setCalendars([]);
        setSelectedCalendarId("primary");
        clearCalendarExplicitChoice();
        setEvents([]);
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
        setCastReady(false);
        setCastSessionConnected(false);
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
    if (!status?.spotifyConfigured || !status.spotifyLinked) {
      queueMicrotask(() => {
        setCastReady(false);
        setCastSessionConnected(false);
        setCastWakeBaselineIds(null);
        setCastTargetName(null);
        setCastSupportHint(null);
      });
      if (castWakePollingRef.current !== null) {
        window.clearInterval(castWakePollingRef.current);
        castWakePollingRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let cleanupSessionListener: (() => void) | null = null;

    const initCast = () => {
      if (cancelled) return;
      const framework = window.cast?.framework;
      const chromeCast = window.chrome?.cast;
      if (!framework || !chromeCast) {
        setCastSupportHint(
          "Cast SDK loaded but browser Cast APIs are unavailable. Use Chrome or a Cast-enabled Chromium build.",
        );
        return;
      }

      const castContext = framework.CastContext.getInstance();
      castContext.setOptions({
        receiverApplicationId: "CC32E753",
        autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      setCastReady(true);
      setCastSupportHint(null);

      const handler = (evt: { sessionState?: string }) => {
        if (cancelled) return;
        const state = evt.sessionState;
        const connected =
          state === framework.SessionState.SESSION_STARTED ||
          state === framework.SessionState.SESSION_RESUMED;
        setCastSessionConnected(connected);
        if (connected) {
          const sessionName = castContext
            .getCurrentSession?.()
            ?.getCastDevice?.()
            ?.friendlyName?.trim();
          if (sessionName) setCastTargetName(sessionName);
        }
        if (!connected && castWakePollingRef.current !== null) {
          window.clearInterval(castWakePollingRef.current);
          castWakePollingRef.current = null;
        }
      };
      castContext.addEventListener(
        framework.CastContextEventType.SESSION_STATE_CHANGED,
        handler,
      );
      cleanupSessionListener = () => {
        castContext.removeEventListener(
          framework.CastContextEventType.SESSION_STATE_CHANGED,
          handler,
        );
      };
    };

    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (isAvailable) {
        initCast();
      } else {
        setCastSupportHint(
          "Cast framework is unavailable in this browser/profile. Try Google Chrome.",
        );
      }
    };

    const existing = document.querySelector(
      'script[src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"]',
    ) as HTMLScriptElement | null;
    if (existing) {
      if (window.cast?.framework) initCast();
    } else {
      const script = document.createElement("script");
      script.src =
        "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
      script.async = true;
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      cleanupSessionListener?.();
      if (castWakePollingRef.current !== null) {
        window.clearInterval(castWakePollingRef.current);
        castWakePollingRef.current = null;
      }
    };
  }, [status?.spotifyConfigured, status?.spotifyLinked]);

  useEffect(() => {
    if (!castSessionConnected || !castWakeBaselineIds) return;
    if (castWakePollingRef.current !== null) {
      window.clearInterval(castWakePollingRef.current);
    }

    const baseline = new Set(castWakeBaselineIds);
    const desiredCastName = normalizeName(castTargetName ?? undefined);
    let attempts = 0;
    castWakePollingRef.current = window.setInterval(() => {
      attempts += 1;
      void (async () => {
        const devices = await fetchSpotifyDevices();
        if (!devices) return;
        const newlyAppeared = devices.find((d) => d.id && !baseline.has(d.id));
        const nameMatched =
          desiredCastName.length > 0
            ? devices.find((d) => {
                const n = normalizeName(d.name);
                return Boolean(n) && (n.includes(desiredCastName) || desiredCastName.includes(n));
              })
            : null;
        const selectedMatched = spotifySelectedDeviceId
          ? devices.find((d) => d.id === spotifySelectedDeviceId)
          : null;
        const awakened = newlyAppeared ?? nameMatched ?? selectedMatched;
        if (awakened?.id) {
          window.clearInterval(castWakePollingRef.current!);
          castWakePollingRef.current = null;
          setCastWakeBaselineIds(null);
          setSpotifySelectedDeviceId(awakened.id);
          setSpotifyNotice(
            `Cast device awakened: ${awakened.name ?? "device"}. Transferring playback...`,
          );
          const transferRes = await fetch("/api/spotify/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "set_device",
              deviceId: awakened.id,
              play: true,
            }),
          });
          if (!transferRes.ok) {
            setSpotifyNotice("Awakened cast device found, but transfer failed. Try selecting it manually.");
          } else {
            setSpotifyNotice(`Awakened ${awakened.name ?? "cast device"} and transferred playback.`);
            await fetchBoard();
          }
        } else if (attempts >= 30) {
          window.clearInterval(castWakePollingRef.current!);
          castWakePollingRef.current = null;
          setCastWakeBaselineIds(null);
          setSpotifyNotice(
            "Cast connected, but no new Spotify device appeared yet. Start Spotify on the speaker, then refresh.",
          );
        }
      })();
    }, 2_000);

    return () => {
      if (castWakePollingRef.current !== null) {
        window.clearInterval(castWakePollingRef.current);
        castWakePollingRef.current = null;
      }
    };
  }, [
    castSessionConnected,
    castWakeBaselineIds,
    castTargetName,
    spotifySelectedDeviceId,
    fetchSpotifyDevices,
    fetchBoard,
  ]);

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
  ) {
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
      (action === "play_track" || action === "play_context" || action === "queue_track") &&
      !spotifyEffectiveDeviceId &&
      !spotifySdkDeviceId &&
      !extra?.deviceId
    ) {
      const msg =
        "No Spotify device selected. Open Spotify on your phone/computer/speaker, then pick a device and try again.";
      setDismissedAlertSignature(null);
      setMessage(msg);
      setSpotifyNotice(msg);
      return;
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
      const msg = [j.error, detail].filter(Boolean).join(" — ") || "Spotify action failed";
      setMessage(msg);
      setSpotifyNotice(msg);
      return;
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
        }
      }
    }
  }

  async function commitSpotifySeek() {
    if (spotifySeekDraft === null) return;
    const duration = Number(spotifyTrack?.duration_ms ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const clamped = Math.max(0, Math.min(duration, Math.round(spotifySeekDraft)));
    await spotifyControl("seek", { positionMs: clamped });
  }

  async function searchSpotify() {
    const q = spotifyQuery.trim();
    if (!q) {
      setSpotifySearchResults({ tracks: [], albums: [], playlists: [] });
      return;
    }
    setSpotifySearching(true);
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}&limit=8`);
    setSpotifySearching(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Spotify search failed");
      return;
    }
    const data = (await res.json()) as {
      tracks?: SpotifySearchTrack[];
      albums?: SpotifySearchAlbum[];
      playlists?: SpotifySearchPlaylist[];
    };
    const next = {
      tracks: data.tracks ?? [],
      albums: data.albums ?? [],
      playlists: data.playlists ?? [],
    };
    setSpotifySearchResults(next);
    if (next.tracks.length > 0) setSpotifyResultTab("tracks");
    else if (next.albums.length > 0) setSpotifyResultTab("albums");
    else if (next.playlists.length > 0) setSpotifyResultTab("playlists");
  }

  function beginCastWakeFlow() {
    const baselineIds = Array.from(
      new Set(
      spotifyDevices.map((d) => d.id).filter((id): id is string => Boolean(id)),
      ),
    );
    setCastWakeBaselineIds(baselineIds);
    setCastTargetName(null);
    setSpotifyNotice(
      "Select a speaker in the Cast dialog to wake Spotify on that device. We'll auto-handoff when it appears.",
    );
  }

  async function openCastDeviceChooser() {
    beginCastWakeFlow();
    const framework = window.cast?.framework;
    if (!framework) {
      setSpotifyNotice("Cast framework is not available in this browser.");
      return;
    }
    try {
      const castContext = framework.CastContext.getInstance();
      await castContext.requestSession();
      const castDeviceName = castContext
        .getCurrentSession?.()
        ?.getCastDevice?.()
        ?.friendlyName?.trim();
      if (castDeviceName) {
        setCastTargetName(castDeviceName);
        setSpotifyNotice(
          `Cast selected: ${castDeviceName}. Waiting for matching Spotify device and auto-handoff...`,
        );
      }
    } catch {
      setSpotifyNotice("Cast chooser did not open. Check browser cast support and try again.");
    }
  }

  function openRangePicker() {
    setPickerDraft({ from: rangeKeys.fromKey, to: rangeKeys.toInclusiveKey });
    setRangePickerOpen(true);
  }

  function applyRangePicker() {
    setRangeKeys({
      fromKey: pickerDraft.from,
      toInclusiveKey: pickerDraft.to,
    });
    setRangePickerOpen(false);
  }

  function resetCalendarRange() {
    const k = defaultCalendarRangeKeys(4);
    setRangeKeys(k);
    setPickerDraft({ from: k.fromKey, to: k.toInclusiveKey });
    setRangePickerOpen(false);
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
  const spotifyDurationMs = Math.max(0, Number(spotifyTrack?.duration_ms ?? 0));
  const spotifyProgressMs = Math.max(
    0,
    Math.min(
      spotifyDurationMs || Number.MAX_SAFE_INTEGER,
      Number(spotifySeekDraft ?? spotifyPlayback?.progress_ms ?? 0),
    ),
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

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden sm:gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-3 md:p-4">
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
                    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
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
                  <button
                    type="button"
                    className="rounded-full border border-slate-600 px-4 py-2 text-base text-slate-100 hover:border-slate-400 sm:py-2.5 sm:text-lg"
                    onClick={() => openRangePicker()}
                  >
                    Dates
                  </button>
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

          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto sm:gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Clock</h2>
                <button
                  type="button"
                  className="text-sm text-slate-400 hover:text-white sm:text-base"
                  onClick={() => toggleWidgetCollapse("clock")}
                >
                  {collapsedWidgets.clock ? "Expand" : "Collapse"}
                </button>
              </div>
              {!collapsedWidgets.clock ? (
                <>
                  <p className="mt-3 text-xs uppercase tracking-wide text-slate-400 sm:text-sm">
                    {clockDate}
                  </p>
                  <p className="mt-1 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                    {clockTime}
                  </p>
                </>
              ) : null}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Weather</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => void fetchBoard()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => toggleWidgetCollapse("weather")}
                  >
                    {collapsedWidgets.weather ? "Expand" : "Collapse"}
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
                  <div className="grid grid-cols-[minmax(0,1fr)_8.25rem] gap-2">
                    <div className="min-w-0">
                      <p className="text-4xl font-semibold leading-none text-white sm:text-5xl">
                        {Math.round(current.temperatureF ?? 0)}°
                        <span className="text-base text-slate-400 sm:text-lg">F</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                        Humidity {Math.round(current.humidity ?? 0)}% · Wind{" "}
                        {Math.round(current.windMph ?? 0)} mph
                      </p>
                      <WeatherIcon
                        code={Number(current.code ?? 0)}
                        className="mt-2 h-10 w-10 sm:h-12 sm:w-12"
                      />
                    </div>
                    {daily && daily.length > 0 ? (
                      <div className="grid grid-cols-1 gap-1.5">
                        {daily.slice(0, 3).map((d) => (
                          <div
                            key={d.date}
                            className="flex min-w-0 items-center justify-between gap-1 rounded-lg border border-slate-800/90 bg-slate-950/50 px-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-xs">
                                {shortWeekdayFromForecastDate(d.date ?? "")}
                              </p>
                              <p className="text-[11px] font-medium text-white sm:text-xs">
                                {Math.round(d.minF ?? 0)}–{Math.round(d.maxF ?? 0)}°
                              </p>
                            </div>
                            <WeatherIcon
                              code={Number(d.code ?? 0)}
                              className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
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
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => void fetchBoard()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => toggleWidgetCollapse("hue")}
                  >
                    {collapsedWidgets.hue ? "Expand" : "Collapse"}
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
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {areas.map((area) => (
                    <li
                      key={area.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-white sm:text-lg">
                          {area.name}
                        </p>
                        <p className="text-xs uppercase tracking-wide text-slate-500 sm:text-sm">
                          {area.type}
                        </p>
                      </div>
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
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-medium text-white sm:text-2xl">Spotify</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => void fetchBoard()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white sm:text-base"
                    onClick={() => toggleWidgetCollapse("spotify")}
                  >
                    {collapsedWidgets.spotify ? "Expand" : "Collapse"}
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
                        <div className="mt-3">
                          <input
                            type="range"
                            min={0}
                            max={spotifyDurationMs}
                            step={1000}
                            value={spotifyProgressMs}
                            className="w-full accent-sky-500"
                            onChange={(e) =>
                              setSpotifySeekDraft(Number(e.currentTarget.value))
                            }
                            onMouseUp={() => void commitSpotifySeek()}
                            onTouchEnd={() => void commitSpotifySeek()}
                          />
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-400 sm:text-sm">
                            <span>{formatMsClock(spotifyProgressMs)}</span>
                            <span>{formatMsClock(spotifyDurationMs)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-base text-slate-400 sm:text-lg">
                      Nothing is currently playing.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
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
                  </div>

                  <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                    Device
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
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
                    <p className="mt-1 text-xs normal-case tracking-normal text-slate-500 sm:text-sm">
                      Only Spotify Connect devices appear here. If a speaker is missing,
                      use Cast wake-up below, then wait for auto-handoff.
                    </p>
                  </label>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-xs text-slate-400 sm:text-sm">
                      FamilyBoard player:{" "}
                      <span className={spotifySdkReady ? "text-emerald-300" : "text-slate-500"}>
                        {spotifySdkReady ? "ready" : "not ready"}
                      </span>
                    </p>
                    {spotifySdkDeviceId ? (
                      <button
                        type="button"
                        className="rounded-full border border-slate-600 px-2.5 py-1 text-xs text-slate-100 hover:border-slate-400"
                        onClick={() =>
                          {
                            if (!spotifySdkDeviceId) return;
                            setSpotifySelectedDeviceId(spotifySdkDeviceId);
                            void spotifyControl("set_device", {
                              deviceId: spotifySdkDeviceId,
                              play: false,
                            });
                          }
                        }
                      >
                        Play here
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-xs text-slate-400 sm:text-sm">
                      Cast bridge:{" "}
                      <span className={castReady ? "text-emerald-300" : "text-slate-500"}>
                        {castReady ? (castSessionConnected ? "connected" : "ready") : "unavailable"}
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-slate-600 px-2.5 py-1 text-xs text-slate-100 hover:border-slate-400"
                        onClick={() => void openCastDeviceChooser()}
                      >
                        Choose speaker
                      </button>
                      {createElement("google-cast-launcher", {
                        className:
                          "cursor-pointer rounded-full border border-slate-600 p-1.5 text-slate-100 hover:border-slate-400",
                        title: "Wake Chromecast for Spotify",
                        onClick: beginCastWakeFlow,
                      })}
                    </div>
                  </div>
                  {castSupportHint ? (
                    <p className="text-xs normal-case tracking-normal text-amber-300 sm:text-sm">
                      {castSupportHint}
                    </p>
                  ) : null}

                  <div className="rounded-lg border border-slate-800 bg-slate-950/35 p-2.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Choose music
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500 sm:text-base"
                        placeholder="Search tracks, albums, playlists"
                        value={spotifyQuery}
                        onChange={(e) => setSpotifyQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void searchSpotify();
                        }}
                      />
                      <button
                        type="button"
                        disabled={spotifySearching}
                        className="rounded-full bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:text-base"
                        onClick={() => void searchSpotify()}
                      >
                        {spotifySearching ? "..." : "Search"}
                      </button>
                    </div>
                    {(spotifySearchResults.tracks.length > 0 ||
                      spotifySearchResults.albums.length > 0 ||
                      spotifySearchResults.playlists.length > 0) ? (
                      <>
                        <div className="mt-2 flex gap-1.5">
                          {(["tracks", "albums", "playlists"] as const).map((tab) => (
                            <button
                              key={tab}
                              type="button"
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                spotifyResultTab === tab
                                  ? "bg-sky-600 text-white"
                                  : "border border-slate-600 text-slate-300 hover:border-slate-400"
                              }`}
                              onClick={() => setSpotifyResultTab(tab)}
                            >
                              {tab[0]!.toUpperCase() + tab.slice(1)}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                          {spotifyResultTab === "tracks"
                            ? spotifySearchResults.tracks.slice(0, 8).map((t) => (
                                <div
                                  key={`t-${t.id}`}
                                  className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    {t.album?.images?.[0]?.url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={t.album.images[0].url}
                                        alt=""
                                        className="h-9 w-9 shrink-0 rounded object-cover"
                                      />
                                    ) : (
                                      <div className="h-9 w-9 shrink-0 rounded border border-slate-700 bg-slate-900/70" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-white sm:text-base">
                                        {t.name ?? "Unknown track"}
                                      </p>
                                      <p className="truncate text-xs text-slate-400 sm:text-sm">
                                        {t.artists
                                          ?.map((a) => a.name)
                                          .filter(Boolean)
                                          .join(", ") ?? "Unknown artist"}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-1.5 flex gap-1.5">
                                    <button
                                      type="button"
                                      className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                      onClick={() =>
                                        void spotifyControl("play_track", {
                                          uri: t.uri,
                                          deviceId: spotifyEffectiveDeviceId || undefined,
                                        })
                                      }
                                    >
                                      Play now
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-slate-600 px-2.5 py-1 text-xs text-slate-100 hover:border-slate-400"
                                      onClick={() =>
                                        void spotifyControl("queue_track", {
                                          uri: t.uri,
                                          deviceId: spotifyEffectiveDeviceId || undefined,
                                        })
                                      }
                                    >
                                      Queue
                                    </button>
                                  </div>
                                </div>
                              ))
                            : null}
                          {spotifyResultTab === "albums"
                            ? spotifySearchResults.albums.slice(0, 8).map((a) => (
                                <div
                                  key={`a-${a.id}`}
                                  className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    {a.images?.[0]?.url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={a.images[0].url}
                                        alt=""
                                        className="h-9 w-9 shrink-0 rounded object-cover"
                                      />
                                    ) : (
                                      <div className="h-9 w-9 shrink-0 rounded border border-slate-700 bg-slate-900/70" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-white sm:text-base">
                                        Album: {a.name ?? "Unknown"}
                                      </p>
                                      <p className="truncate text-xs text-slate-400 sm:text-sm">
                                        {a.artists
                                          ?.map((x) => x.name)
                                          .filter(Boolean)
                                          .join(", ") ?? "Unknown artist"}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="mt-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                    onClick={() =>
                                      void spotifyControl("play_context", {
                                        uri: a.uri,
                                        deviceId: spotifyEffectiveDeviceId || undefined,
                                      })
                                    }
                                  >
                                    Play album
                                  </button>
                                </div>
                              ))
                            : null}
                          {spotifyResultTab === "playlists"
                            ? spotifySearchResults.playlists.slice(0, 8).map((p) => (
                                <div
                                  key={`p-${p.id}`}
                                  className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    {p.images?.[0]?.url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={p.images[0].url}
                                        alt=""
                                        className="h-9 w-9 shrink-0 rounded object-cover"
                                      />
                                    ) : (
                                      <div className="h-9 w-9 shrink-0 rounded border border-slate-700 bg-slate-900/70" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-white sm:text-base">
                                        Playlist: {p.name ?? "Unknown"}
                                      </p>
                                      <p className="truncate text-xs text-slate-400 sm:text-sm">
                                        by {p.owner?.display_name ?? "Unknown owner"}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="mt-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                    onClick={() =>
                                      void spotifyControl("play_context", {
                                        uri: p.uri,
                                        deviceId: spotifyEffectiveDeviceId || undefined,
                                      })
                                    }
                                  >
                                    Play playlist
                                  </button>
                                </div>
                              ))
                            : null}
                        </div>
                      </>
                    ) : null}
                  </div>

                  <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
                    Volume {Math.round(spotifyActiveDevice?.volume_percent ?? 0)}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(spotifyActiveDevice?.volume_percent ?? 0)}
                      disabled={!spotifyActiveDevice}
                      className="mt-2 w-full accent-sky-500 disabled:opacity-40"
                      onChange={(e) =>
                        void spotifyControl("set_volume", {
                          volumePercent: Number(e.target.value),
                        })
                      }
                    />
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

      <CalendarRangePickerModal
        open={rangePickerOpen}
        draftFrom={pickerDraft.from}
        draftTo={pickerDraft.to}
        onDraftFrom={(from) => setPickerDraft((d) => ({ ...d, from }))}
        onDraftTo={(to) => setPickerDraft((d) => ({ ...d, to }))}
        onClose={() => setRangePickerOpen(false)}
        onApply={() => applyRangePicker()}
        onReset={() => resetCalendarRange()}
      />

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
    </div>
    <OnekoCat enabled />
    </>
  );
}
