import { fetchCatlinkSnapshot, getCatlinkConfig } from "./catlink";
import { getDefaultTimeZone } from "./google";
import {
  formatHouseDashboardText,
  type HousePanel,
  type HouseQuickAction,
} from "./house-dashboard-format";
import { isHueConfigured, listHueAreas, type HueArea } from "./hue";
import { readSpotifyTokens, requireSpotifyOAuthEnv, spotifyApiFetch } from "./spotify";
import { fetchOpenMeteo } from "./weather";

export type { HousePanel, HouseQuickAction } from "./house-dashboard-format";
export { formatHouseDashboardText } from "./house-dashboard-format";

export type HouseDashboard = {
  asOf: string;
  timeZone: string;
  panels: HousePanel[];
  quickActions: HouseQuickAction[];
  linked: {
    hue: boolean;
    spotify: boolean;
    catlink: boolean;
    weather: boolean;
  };
};

function squash(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function spotifyReady(): Promise<boolean> {
  try {
    requireSpotifyOAuthEnv();
  } catch {
    return false;
  }
  return Boolean((await readSpotifyTokens())?.refresh_token);
}

async function loadHue(): Promise<{ linked: boolean; areas: HueArea[]; error?: string }> {
  if (!(await isHueConfigured())) return { linked: false, areas: [] };
  try {
    return { linked: true, areas: await listHueAreas() };
  } catch (e) {
    return { linked: true, areas: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function loadCatlink(): Promise<{
  linked: boolean;
  wasteBinFull?: boolean;
  wasteBinStatusLabel?: string;
  catName?: string | null;
  online?: boolean;
  error?: string;
}> {
  if (!(await getCatlinkConfig())) return { linked: false };
  try {
    const snap = await fetchCatlinkSnapshot();
    return {
      linked: true,
      wasteBinFull: snap.wasteBinFull,
      wasteBinStatusLabel: snap.wasteBinStatusLabel,
      catName: snap.catName ?? null,
      online: snap.online,
    };
  } catch (e) {
    return { linked: true, error: e instanceof Error ? e.message : String(e) };
  }
}

async function loadSpotify(): Promise<{
  linked: boolean;
  isPlaying?: boolean;
  track?: string;
  artist?: string;
  device?: string;
  volumePercent?: number;
  error?: string;
}> {
  if (!(await spotifyReady())) return { linked: false };
  try {
    const res = await spotifyApiFetch<{
      is_playing?: boolean;
      item?: { name?: string; artists?: Array<{ name?: string }> };
      device?: { name?: string; volume_percent?: number };
    }>("/me/player");
    if (res.status === 204 || !res.data) {
      return { linked: true, isPlaying: false, track: undefined };
    }
    if (res.status >= 400) {
      return { linked: true, error: `Spotify ${res.status}` };
    }
    const artists = res.data.item?.artists?.map((a) => a.name).filter(Boolean).join(", ");
    return {
      linked: true,
      isPlaying: Boolean(res.data.is_playing),
      track: res.data.item?.name,
      artist: artists || undefined,
      device: res.data.device?.name,
      volumePercent:
        typeof res.data.device?.volume_percent === "number"
          ? Math.round(res.data.device.volume_percent)
          : undefined,
    };
  } catch (e) {
    return { linked: true, error: e instanceof Error ? e.message : String(e) };
  }
}

async function loadWeather(): Promise<{ linked: boolean; summary?: string; error?: string }> {
  try {
    const snap = await fetchOpenMeteo();
    if (!snap) return { linked: false };
    const cur = snap.current;
    const bits = [`${Math.round(cur.temperatureF)}°F`];
    bits.push(`${Math.round(cur.humidity)}% humidity`);
    bits.push(`${Math.round(cur.windMph)} mph wind`);
    return { linked: true, summary: bits.join(" · ") };
  } catch (e) {
    return { linked: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the live house snapshot + follow-up actions for chat / Slack. */
export async function fetchHouseDashboard(): Promise<HouseDashboard> {
  const timeZone = getDefaultTimeZone();
  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

  const [hue, catlink, spotify, weather] = await Promise.all([
    loadHue(),
    loadCatlink(),
    loadSpotify(),
    loadWeather(),
  ]);

  const panels: HousePanel[] = [];
  const quickActions: HouseQuickAction[] = [];

  if (weather.linked && weather.summary) {
    panels.push({ id: "weather", title: "Outside", status: weather.summary });
  }

  if (hue.linked) {
    if (hue.error) {
      panels.push({ id: "lights", title: "Lights", status: `Unavailable · ${hue.error}` });
    } else if (!hue.areas.length) {
      panels.push({ id: "lights", title: "Lights", status: "No rooms found" });
    } else {
      const on = hue.areas.filter((a) => a.on);
      const off = hue.areas.filter((a) => !a.on);
      panels.push({
        id: "lights",
        title: "Lights",
        status: on.length ? `${on.length} on · ${off.length} off` : "All off",
        detail: on.length
          ? `On: ${on.map((a) => a.name).join(", ")}`
          : `Rooms: ${hue.areas.map((a) => a.name).join(", ")}`,
      });
      for (const area of on.slice(0, 4)) {
        quickActions.push({
          id: `hue-off-${squash(area.name)}`,
          label: `${area.name} off`,
          prompt: `Turn off ${area.name} lights`,
        });
      }
      if (on.length >= 2) {
        quickActions.push({
          id: "hue-all-off",
          label: "All lights off",
          prompt: "Turn off all the lights",
        });
      }
      for (const area of off.slice(0, 2)) {
        quickActions.push({
          id: `hue-on-${squash(area.name)}`,
          label: `${area.name} on`,
          prompt: `Turn on ${area.name} lights`,
        });
      }
    }
  }

  if (catlink.linked) {
    if (catlink.error) {
      panels.push({ id: "litter", title: "Litter box", status: `Unavailable · ${catlink.error}` });
    } else {
      const full = Boolean(catlink.wasteBinFull);
      const label = catlink.wasteBinStatusLabel || (full ? "Change bag" : "OK");
      panels.push({
        id: "litter",
        title: "Litter box",
        status: full ? `Needs attention · ${label}` : label,
        detail: [catlink.catName, catlink.online === false ? "offline" : null]
          .filter(Boolean)
          .join(" · ") || undefined,
        attention: full,
      });
      if (full) {
        quickActions.unshift({
          id: "catlink-change-bag",
          label: "Change bag",
          prompt: "Change the litter bag",
        });
        quickActions.splice(1, 0, {
          id: "catlink-reset-bin",
          label: "Reset bin",
          prompt: "Reset the litter waste bin",
        });
      } else {
        quickActions.push({
          id: "catlink-clean",
          label: "Clean now",
          prompt: "Run a litter box clean now",
        });
      }
    }
  }

  if (spotify.linked) {
    if (spotify.error) {
      panels.push({ id: "music", title: "Music", status: `Unavailable · ${spotify.error}` });
    } else if (spotify.isPlaying && spotify.track) {
      panels.push({
        id: "music",
        title: "Music",
        status: `Playing · ${spotify.track}`,
        detail: [spotify.artist, spotify.device, spotify.volumePercent != null ? `${spotify.volumePercent}%` : null]
          .filter(Boolean)
          .join(" · "),
      });
      quickActions.push(
        { id: "spotify-pause", label: "Pause", prompt: "Pause Spotify" },
        { id: "spotify-next", label: "Next track", prompt: "Skip to the next Spotify track" },
      );
    } else {
      panels.push({
        id: "music",
        title: "Music",
        status: spotify.track ? `Paused · ${spotify.track}` : "Idle",
        detail: spotify.device,
      });
      quickActions.push({ id: "spotify-play", label: "Play", prompt: "Play Spotify" });
    }
  }

  if (!panels.length) {
    panels.push({
      id: "empty",
      title: "House",
      status: "No linked devices yet — connect Hue, CatLink, or Spotify on the Board.",
    });
  }

  // Dedupe by id, keep first (attention actions first).
  const seen = new Set<string>();
  const deduped = quickActions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  return {
    asOf,
    timeZone,
    panels,
    quickActions: deduped.slice(0, 8),
    linked: {
      hue: hue.linked,
      spotify: spotify.linked,
      catlink: catlink.linked,
      weather: weather.linked,
    },
  };
}

