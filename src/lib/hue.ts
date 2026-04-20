import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";

const HUE_FILE = "hue.json";

type HueFile = { username: string };

export function getHueBridgeIp(): string | null {
  const ip = process.env.HUE_BRIDGE_IP?.trim();
  return ip || null;
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
