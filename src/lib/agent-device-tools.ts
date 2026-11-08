import type { AgentTool } from "./agent";
import { executeCatlinkAction, getCatlinkConfig, type CatlinkAction } from "./catlink";
import { fetchHouseDashboard, formatHouseDashboardText } from "./house-dashboard";
import { controlHueArea, isHueConfigured, listHueAreas } from "./hue";
import { readSpotifyTokens, requireSpotifyOAuthEnv, spotifyApiFetch } from "./spotify";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined;

const CATLINK_ACTIONS = new Set<CatlinkAction>([
  "clean_now",
  "refill_litter",
  "change_bag",
  "reset_bin",
]);

async function isSpotifyReady(): Promise<boolean> {
  try {
    requireSpotifyOAuthEnv();
  } catch {
    return false;
  }
  return Boolean((await readSpotifyTokens())?.refresh_token);
}

async function isCatlinkReady(): Promise<boolean> {
  return Boolean(await getCatlinkConfig());
}

export async function deviceToolsAvailable(): Promise<{
  hue: boolean;
  spotify: boolean;
  catlink: boolean;
}> {
  const [hue, spotify, catlink] = await Promise.all([
    isHueConfigured(),
    isSpotifyReady(),
    isCatlinkReady(),
  ]);
  return { hue, spotify, catlink };
}

export function buildDeviceTools(ready: {
  hue: boolean;
  spotify: boolean;
  catlink: boolean;
}): AgentTool[] {
  const tools: AgentTool[] = [
    {
      declaration: {
        name: "house_dashboard",
        description:
          "Show a live house dashboard: lights, litter box, Spotify, and outdoor weather, plus suggested follow-up actions. Call this when someone asks for the house status, dashboard, what's on, or a home overview.",
        parameters: { type: "object", properties: {} },
      },
      async run(_args, ctx) {
        const channel = ctx.channel ?? "board";
        const dash = await fetchHouseDashboard();
        return {
          response: {
            ...dash,
            summary: formatHouseDashboardText(dash, channel),
          },
          label: "House dashboard",
          quickActions: dash.quickActions,
        };
      },
    },
  ];

  if (ready.hue) {
    tools.push(
      {
        declaration: {
          name: "list_lights",
          description: "List Hue rooms/zones and whether their lights are on.",
          parameters: { type: "object", properties: {} },
        },
        async run() {
          const areas = await listHueAreas();
          return {
            response: { areas },
            label: `Listed ${areas.length} Hue room(s)`,
          };
        },
      },
      {
        declaration: {
          name: "control_lights",
          description:
            "Turn a Hue room/zone on or off, or set a theme (bright, relax, focus, nightlight). Match the room name from list_lights (e.g. Living room).",
          parameters: {
            type: "object",
            properties: {
              area: {
                type: "string",
                description: 'Room or zone name, e.g. "Living room" or "Kitchen"',
              },
              on: {
                type: "boolean",
                description: "true = on, false = off (omit when setting a theme)",
              },
              theme: {
                type: "string",
                enum: ["bright", "relax", "focus", "nightlight"],
                description: "Optional mood; turns the room on",
              },
            },
            required: ["area"],
          },
        },
        async run(args) {
          const result = await controlHueArea({
            area: str(args.area) ?? "",
            on: bool(args.on),
            theme: str(args.theme),
          });
          const what = result.theme
            ? `${result.theme} in ${result.area.name}`
            : `${result.on ? "On" : "Off"} · ${result.area.name}`;
          return {
            response: {
              area: result.area.name,
              on: result.on,
              theme: result.theme ?? null,
            },
            label: what,
          };
        },
      },
    );
  }

  if (ready.spotify) {
    tools.push({
      declaration: {
        name: "spotify_control",
        description:
          "Control Spotify on the family's active speaker: play, pause, next, previous, or set volume (0–100).",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["play", "pause", "next", "previous", "set_volume"],
            },
            volumePercent: {
              type: "number",
              description: "For set_volume only, 0–100",
            },
          },
          required: ["action"],
        },
      },
      async run(args) {
        const action = str(args.action) ?? "";
        let endpoint = "";
        let method: "PUT" | "POST" = "PUT";
        switch (action) {
          case "play":
            endpoint = "/me/player/play";
            break;
          case "pause":
            endpoint = "/me/player/pause";
            break;
          case "next":
            endpoint = "/me/player/next";
            method = "POST";
            break;
          case "previous":
            endpoint = "/me/player/previous";
            method = "POST";
            break;
          case "set_volume": {
            const vol = Math.max(0, Math.min(100, Math.round(Number(args.volumePercent))));
            if (!Number.isFinite(vol)) throw new Error("volumePercent must be 0–100");
            endpoint = `/me/player/volume?volume_percent=${vol}`;
            break;
          }
          default:
            throw new Error("Unsupported Spotify action");
        }
        const res = await spotifyApiFetch(endpoint, { method });
        if (res.status >= 400) {
          const detail =
            res.data && typeof res.data === "object"
              ? JSON.stringify(res.data).slice(0, 120)
              : "";
          throw new Error(`Spotify ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        const labels: Record<string, string> = {
          play: "Spotify · play",
          pause: "Spotify · pause",
          next: "Spotify · next",
          previous: "Spotify · previous",
          set_volume: `Spotify · volume ${Math.round(Number(args.volumePercent))}%`,
        };
        return { response: { ok: true, action }, label: labels[action] ?? `Spotify · ${action}` };
      },
    });
  }

  if (ready.catlink) {
    tools.push({
      declaration: {
        name: "catlink_control",
        description:
          "Control the CatLink litter box: clean_now, refill_litter, change_bag, or reset_bin.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["clean_now", "refill_litter", "change_bag", "reset_bin"],
            },
          },
          required: ["action"],
        },
      },
      async run(args) {
        const action = (str(args.action) ?? "") as CatlinkAction;
        if (!CATLINK_ACTIONS.has(action)) throw new Error("Unsupported CatLink action");
        await executeCatlinkAction(action);
        const labels: Record<CatlinkAction, string> = {
          clean_now: "CatLink · clean",
          refill_litter: "CatLink · refill litter",
          change_bag: "CatLink · change bag",
          reset_bin: "CatLink · reset bin",
        };
        return { response: { ok: true, action }, label: labels[action] };
      },
    });
  }

  return tools;
}
