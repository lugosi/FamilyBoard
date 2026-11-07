import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { squashHueAreaName } from "./hue-name";

export { squashHueAreaName } from "./hue-name";

const HUE_FILE = "hue.json";

type HueFile = { username: string };

export const HUE_THEMES = {
  bright: { on: true, bri: 254, ct: 250 },
  relax: { on: true, bri: 170, ct: 367 },
  focus: { on: true, bri: 220, ct: 233 },
  nightlight: { on: true, bri: 25, ct: 447 },
} as const;

export type HueTheme = keyof typeof HUE_THEMES;

export type HueArea = {
  id: string;
  name: string;
  type: "room" | "zone";
  on: boolean;
};

export function getHueBridgeIp(): string | null {
  const ip = process.env.HUE_BRIDGE_IP?.trim();
  return ip || null;
}

export async function isHueConfigured(): Promise<boolean> {
  return Boolean(getHueBridgeIp() && (await readHueUsername()));
}

export async function readHueUsername(): Promise<string | null> {
  const envUser = process.env.HUE_USERNAME?.trim();
  if (envUser) return envUser;
  try {
    const raw = await fs.readFile(path.join(getDataDir(), HUE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as HueFile;
    return parsed.username ?? null;
  } catch {
    return null;
  }
}

export async function writeHueUsername(username: string): Promise<void> {
  const body: HueFile = { username };
  await fs.writeFile(
    path.join(getDataDir(), HUE_FILE),
    JSON.stringify(body, null, 2),
    "utf-8",
  );
}

export async function hueBridgeFetch(
  bridgeIp: string,
  username: string,
  resourcePath: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `http://${bridgeIp}/api/${username}${resourcePath}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers as Record<string, string>),
    },
    cache: "no-store",
  });
}

async function requireHue(): Promise<{ bridgeIp: string; username: string }> {
  const bridgeIp = getHueBridgeIp();
  const username = await readHueUsername();
  if (!bridgeIp || !username) {
    throw new Error("Hue is not set up. Set HUE_BRIDGE_IP and pair the bridge on the board.");
  }
  return { bridgeIp, username };
}

export async function listHueAreas(): Promise<HueArea[]> {
  const { bridgeIp, username } = await requireHue();
  const res = await hueBridgeFetch(bridgeIp, username, "/groups");
  if (!res.ok) throw new Error(`Hue bridge returned ${res.status}`);
  const raw = (await res.json()) as Record<
    string,
    { name?: string; type?: string; state?: { any_on?: boolean }; action?: { on?: boolean } }
  >;
  return Object.entries(raw)
    .map(([id, g]) => {
      const t = (g.type ?? "").toLowerCase();
      if (t !== "room" && t !== "zone") return null;
      return {
        id,
        name: g.name ?? `Area ${id}`,
        type: t as "room" | "zone",
        on: Boolean(g.state?.any_on ?? g.action?.on),
      };
    })
    .filter((v): v is HueArea => Boolean(v))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a spoken room name like "living room" to a Hue room/zone. */
export async function findHueArea(query: string): Promise<HueArea> {
  const areas = await listHueAreas();
  const q = squashHueAreaName(query);
  if (!q) throw new Error("Which room? e.g. Living room");
  const exact = areas.find((a) => squashHueAreaName(a.name) === q);
  if (exact) return exact;
  const partial = areas.filter((a) => {
    const n = squashHueAreaName(a.name);
    return n.includes(q) || q.includes(n);
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Several rooms match “${query}”: ${partial.map((a) => a.name).join(", ")}. Which one?`,
    );
  }
  throw new Error(
    `No Hue room named “${query}”. Rooms: ${areas.map((a) => a.name).join(", ") || "(none)"}`,
  );
}

export async function controlHueArea(input: {
  area: string;
  on?: boolean;
  theme?: string;
}): Promise<{ area: HueArea; on: boolean; theme?: HueTheme }> {
  const hasOn = typeof input.on === "boolean";
  const themeRaw = input.theme?.trim().toLowerCase() ?? "";
  const theme = themeRaw ? (themeRaw as HueTheme) : undefined;
  if (!hasOn && !theme) {
    throw new Error('Say on/off, or a theme: bright, relax, focus, nightlight');
  }
  if (theme && !(theme in HUE_THEMES)) {
    throw new Error("Unknown theme. Use bright, relax, focus, or nightlight.");
  }
  const area = await findHueArea(input.area);
  const { bridgeIp, username } = await requireHue();
  const payload = theme ? HUE_THEMES[theme] : { on: Boolean(input.on) };
  const res = await hueBridgeFetch(bridgeIp, username, `/groups/${area.id}/action`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Hue bridge returned ${res.status}`);
  return {
    area: { ...area, on: theme ? true : Boolean(input.on) },
    on: theme ? true : Boolean(input.on),
    ...(theme ? { theme } : {}),
  };
}
