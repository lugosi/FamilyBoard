"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarRangePickerModal } from "@/components/calendar/CalendarRangePickerModal";
import { CompactCalendarGrid } from "@/components/calendar/CompactCalendarGrid";
import {
  defaultCalendarRangeKeys,
  enumerateWeekStarts,
  parseLocalDateKey,
  rangeKeysToIso,
  startOfDay,
  type CalendarRangeKeys,
  type GEvent,
} from "@/lib/calendar-layout";
import { wmoLabel } from "@/lib/wmo";

type Light = {
  id: string;
  name: string;
  on: boolean;
  reachable: boolean;
};

type Status = {
  googleLinked: boolean;
  googleConfigured: boolean;
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

export function Board() {
  const search = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [lights, setLights] = useState<Light[]>([]);
  const [weather, setWeather] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newSummary, setNewSummary] = useState("Family dinner");
  const [newTimes, setNewTimes] = useState(() => initialNewEventRange());
  const [newEventOpen, setNewEventOpen] = useState(false);

  const [editOpen, setEditOpen] = useState<GEvent | null>(null);
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

  const urlBanner = useMemo(() => {
    const err = search.get("google_error");
    if (err) return `Google: ${err}`;
    if (search.get("google") === "linked") return "Google Calendar linked.";
    return null;
  }, [search]);

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
            const preferred =
              options.find((c) => c.primary)?.id ??
              options.find((c) => c.selected)?.id ??
              options[0]?.id ??
              "primary";
            activeCalendarId = preferred;
            setSelectedCalendarId(preferred);
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
        setEvents([]);
      }

      if (s.hueReady) {
        const hRes = await fetch("/api/hue/lights", { signal });
        if (signal?.aborted) return;
        if (hRes.status === 501) {
          setLights([]);
        } else if (hRes.ok) {
          const data = (await hRes.json()) as { lights: Light[] };
          setLights(data.lights ?? []);
        }
      } else {
        setLights([]);
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
    [fetchIso.from, fetchIso.to, selectedCalendarId],
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

  async function addEvent() {
    if (selectedCalendarId === "__all__") {
      setMessage("Pick a specific calendar before creating a new event.");
      return;
    }
    setBusy("add");
    setMessage(null);
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: newSummary,
        start: new Date(newTimes.start).toISOString(),
        end: new Date(newTimes.end).toISOString(),
        calendarId: selectedCalendarId,
      }),
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
    const s = ev.start?.dateTime ?? ev.start?.date;
    const e = ev.end?.dateTime ?? ev.end?.date;
    if (!ev.id || !s || !e || ev.start?.date) {
      setMessage("Editing all-day events is not supported in this UI yet.");
      return;
    }
    setEditOpen(ev);
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
    const res = await fetch(
      `/api/calendar/events/${encodeURIComponent(editOpen.id)}?calendarId=${encodeURIComponent(eventCalendarId)}`,
      {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: editSummary,
        start: new Date(editStart).toISOString(),
        end: new Date(editEnd).toISOString(),
      }),
      },
    );
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(j.error ?? "Could not update event");
      return;
    }
    setEditOpen(null);
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
    setMessage("Event deleted.");
    await fetchBoard();
  }

  async function toggleLight(id: string, on: boolean) {
    setBusy(`hue-${id}`);
    const res = await fetch(`/api/hue/lights/${encodeURIComponent(id)}`, {
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
    setMessage("Disconnected Google.");
    await fetchBoard();
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

  function formatRangeSummary(keys: CalendarRangeKeys): string {
    const a = parseLocalDateKey(keys.fromKey);
    const b = parseLocalDateKey(keys.toInclusiveKey);
    return `${a.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: a.getFullYear() === b.getFullYear() ? undefined : "numeric",
    })} – ${b.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }

  const current = weather?.current as
    | { temperatureC?: number; humidity?: number; code?: number; windKmh?: number }
    | undefined;
  const daily = weather?.daily as
    | Array<{ date?: string; maxC?: number; minC?: number; code?: number }>
    | undefined;

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
              Home
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Family board
            </h1>
            <p className="text-sm text-slate-400">
              Calendar, weather, and Hue in one place.
            </p>
          </div>
          {message ?? urlBanner ? (
            <p className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100">
              {message ?? urlBanner}
            </p>
          ) : null}
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/40 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-white">Calendar</h2>
                {status?.googleLinked ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Showing{" "}
                    <span className="text-slate-300">{formatRangeSummary(rangeKeys)}</span>
                    {" · "}
                    compact month-style grid (Mon–Sun)
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {status?.googleConfigured && !status.googleLinked ? (
                  <a
                    className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
                    href="/api/auth/google"
                  >
                    Link Google
                  </a>
                ) : null}
                {status?.googleLinked ? (
                  <>
                    <label className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                      Calendar
                      <select
                        className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none"
                        value={selectedCalendarId}
                        onChange={(e) => setSelectedCalendarId(e.target.value)}
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
                      className="rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setNewEventOpen(true)}
                    >
                      New event
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:border-slate-400"
                      onClick={() => openRangePicker()}
                    >
                      Change dates
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:border-slate-400"
                      onClick={() => void fetchBoard()}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-rose-900/60 px-4 py-2 text-sm text-rose-100 hover:border-rose-700"
                      onClick={() => void logoutGoogle()}
                    >
                      Disconnect Google
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {!status?.googleConfigured ? (
              <p className="mt-4 text-sm text-slate-400">
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

            {status?.googleLinked ? (
              <>
                <div className="mt-4">
                  {weekStarts.length === 0 ? (
                    <p className="text-sm text-slate-400">No weeks in this range.</p>
                  ) : (
                    <CompactCalendarGrid
                      weekStarts={weekStarts}
                      events={events}
                      showCalendarSource={selectedCalendarId === "__all__"}
                      onSelectEvent={(ev) => openEdit(ev)}
                    />
                  )}
                </div>
              </>
            ) : null}
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-medium text-white">Weather</h2>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-white"
                  onClick={() => void fetchBoard()}
                >
                  Refresh
                </button>
              </div>
              {!status?.weatherConfigured ? (
                <p className="mt-3 text-sm text-slate-400">
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
                <div className="mt-3 space-y-2">
                  <p className="text-4xl font-semibold text-white">
                    {Math.round(current.temperatureC ?? 0)}°
                    <span className="text-lg text-slate-400">C</span>
                  </p>
                  <p className="text-sm text-slate-300">
                    {wmoLabel(current.code ?? 0)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Humidity {Math.round(current.humidity ?? 0)}% · Wind{" "}
                    {Math.round(current.windKmh ?? 0)} km/h
                  </p>
                  {daily && daily.length > 0 ? (
                    <ul className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-300">
                      {daily.slice(0, 5).map((d) => (
                        <li key={d.date} className="flex justify-between gap-2">
                          <span>{d.date}</span>
                          <span>
                            {Math.round(d.minC ?? 0)}–{Math.round(d.maxC ?? 0)}°C ·{" "}
                            {wmoLabel(d.code ?? 0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Loading weather…</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-medium text-white">Hue</h2>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-white"
                  onClick={() => void fetchBoard()}
                >
                  Refresh
                </button>
              </div>
              {!status?.hueBridgeIp ? (
                <p className="mt-3 text-sm text-slate-400">
                  Set{" "}
                  <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                    HUE_BRIDGE_IP
                  </code>{" "}
                  on the server.
                </p>
              ) : !status.huePaired ? (
                <div className="mt-3 space-y-3 text-sm text-slate-300">
                  <p>
                    Press the{" "}
                    <span className="font-medium text-white">link</span> button on
                    the bridge, then pair within about 30 seconds.
                  </p>
                  <button
                    type="button"
                    disabled={busy === "pair"}
                    onClick={() => void pairHue()}
                    className="w-full rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {busy === "pair" ? "Pairing…" : "Pair bridge"}
                  </button>
                </div>
              ) : lights.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No lights found.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {lights.map((light) => (
                    <li
                      key={light.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{light.name}</p>
                        <p className="text-xs text-slate-500">
                          {light.reachable ? "Reachable" : "Unreachable"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!light.reachable || busy === `hue-${light.id}`}
                        onClick={() => void toggleLight(light.id, !light.on)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          light.on
                            ? "bg-amber-300 text-slate-900"
                            : "bg-slate-800 text-slate-200"
                        } disabled:opacity-40`}
                      >
                        {light.on ? "On" : "Off"}
                      </button>
                    </li>
                  ))}
                </ul>
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
            <h3 className="text-lg font-semibold text-white">New event</h3>
            <p className="mt-1 text-xs text-slate-400">
              Calendar:{" "}
              {calendars.find((c) => c.id === selectedCalendarId)?.summary ??
                selectedCalendarId}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                Title
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                Start
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                  value={newTimes.start}
                  onChange={(e) =>
                    setNewTimes((t) => ({ ...t, start: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                End
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
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
                className="rounded-full bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
                onClick={() => setNewEventOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "add"}
                className="rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
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
            <h3 className="text-lg font-semibold text-white">Edit event</h3>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                Title
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                Start
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                End
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
                onClick={() => setEditOpen(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "save"}
                className="rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                onClick={() => void saveEdit()}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy === "delete"}
                className="rounded-full bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                onClick={() => void deleteEdit()}
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
