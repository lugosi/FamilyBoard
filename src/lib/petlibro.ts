import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { getDefaultTimeZone } from "./google";

const SESSION_FILE = "petlibro-session.json";
const APP_ID = 1;
const APP_SN = "c35772530d1041699c87fe62348507a8";
const DEFAULT_API_BASE = "https://api.us.petlibro.com";
const PASSWORD_MAX_LENGTH = 18;
const CODE_NOT_YET_LOGIN = 1009;
const CODE_ILLEGAL_PASSWORD = 1102;
const CODE_MEMBER_NOT_EXIST = 1101;

/** Portions → display units (from HA petlibro Unit enum). */
const FEED_UNIT_FACTOR: Record<number, { label: string; factor: number }> = {
  1: { label: "cups", factor: 1 / 12 },
  2: { label: "oz", factor: 0.35 },
  3: { label: "g", factor: 10 },
  4: { label: "ml", factor: 20 },
};

export type PetlibroDeviceKind = "feeder" | "fountain" | "other";

export type PetlibroFeederStats = {
  todayFeedingTimes?: number;
  /** Raw portion count from Petlibro (grain units). */
  todayFeedingQuantityPortions?: number;
  todayFeedingAmount?: number;
  todayFeedingUnit?: string;
  foodLow?: boolean;
  lastFeedAt?: string;
  lastFeedPortions?: number;
};

export type PetlibroFountainStats = {
  todayDrinkMl?: number;
  todayDrinkTimes?: number;
  todayDrinkSeconds?: number;
  yesterdayDrinkMl?: number;
  yesterdayDrinkTimes?: number;
  waterLevelPercent?: number;
  waterWeightG?: number;
};

export type PetlibroDeviceSnapshot = {
  deviceSn: string;
  name: string;
  model?: string;
  modelName?: string;
  kind: PetlibroDeviceKind;
  online?: boolean;
  feeder?: PetlibroFeederStats;
  fountain?: PetlibroFountainStats;
};

export type PetlibroSnapshot = {
  email?: string;
  devices: PetlibroDeviceSnapshot[];
  /** Sum of feeder portions today across devices. */
  totalFoodPortionsToday?: number;
  totalFoodAmountToday?: number;
  totalFoodUnit?: string;
  /** Sum of fountain ml today. */
  totalWaterMlToday?: number;
  totalWaterTimesToday?: number;
  updatedAt: string;
};

type PetlibroSession = {
  email: string;
  password: string;
  token?: string;
  region: string;
  apiBase: string;
  timeZone: string;
  updatedAt?: string;
};

export type PetlibroLinkInput = {
  email: string;
  password: string;
  region?: string;
};

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function hashPassword(password: string): string {
  return createHash("md5").update(password, "utf8").digest("hex");
}

function normalizeApiBase(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function boolish(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function classifyDevice(productIdentifier?: string, productName?: string): PetlibroDeviceKind {
  const id = (productIdentifier || "").toUpperCase();
  const name = (productName || "").toUpperCase();
  if (id.startsWith("PLWF") || name.includes("FOUNTAIN") || name.includes("DOCKSTREAM")) {
    return "fountain";
  }
  if (
    id.startsWith("PLAF") ||
    name.includes("FEEDER") ||
    name.includes("GRANARY") ||
    name.includes("POLAR")
  ) {
    return "feeder";
  }
  return "other";
}

function convertFeedPortions(
  portions: number,
  unitType?: number,
): { amount: number; unit: string; portions: number } {
  const meta = FEED_UNIT_FACTOR[unitType ?? 1] ?? FEED_UNIT_FACTOR[1];
  const amount = Math.round(portions * meta.factor * 1000) / 1000;
  return { amount, unit: meta.label, portions };
}

async function readSession(): Promise<PetlibroSession | null> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), SESSION_FILE), "utf-8");
    const parsed = JSON.parse(raw) as PetlibroSession;
    if (!parsed?.email || !parsed?.password) return null;
    return {
      ...parsed,
      apiBase: normalizeApiBase(parsed.apiBase || DEFAULT_API_BASE),
      region: parsed.region || "US",
      timeZone: parsed.timeZone || getDefaultTimeZone(),
    };
  } catch {
    return null;
  }
}

async function writeSession(session: PetlibroSession): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), SESSION_FILE),
    JSON.stringify(session, null, 2),
    "utf-8",
  );
}

async function clearSession(): Promise<void> {
  try {
    await fs.unlink(path.join(getDataDir(), SESSION_FILE));
  } catch {
    /* noop */
  }
}

export async function isPetlibroLinked(): Promise<boolean> {
  const session = await readSession();
  return Boolean(session?.token || (session?.email && session?.password));
}

export function getPetlibroEnvReady(): boolean {
  return Boolean(
    process.env.PETLIBRO_EMAIL?.trim() && process.env.PETLIBRO_PASSWORD?.trim(),
  );
}

export async function getPetlibroConfig(): Promise<PetlibroSession | null> {
  const session = await readSession();
  const envEmail = process.env.PETLIBRO_EMAIL?.trim();
  const envPassword = process.env.PETLIBRO_PASSWORD?.trim();
  const envRegion = process.env.PETLIBRO_REGION?.trim() || "US";
  const envApiBase =
    process.env.PETLIBRO_API_BASE?.trim() || DEFAULT_API_BASE;

  if (session?.email && session?.password) {
    return {
      ...session,
      password: envPassword || session.password,
      region: session.region || envRegion,
      apiBase: normalizeApiBase(session.apiBase || envApiBase),
      timeZone: session.timeZone || getDefaultTimeZone(),
    };
  }

  if (envEmail && envPassword) {
    return {
      email: envEmail,
      password: envPassword,
      region: envRegion,
      apiBase: normalizeApiBase(envApiBase),
      timeZone: getDefaultTimeZone(),
      token: session?.token,
    };
  }

  return null;
}

type ApiResult =
  | { ok: true; data: Json }
  | { ok: false; code: number; msg: string };

async function petlibroRequest(
  cfg: PetlibroSession,
  apiPath: string,
  body: Record<string, unknown> = {},
  token?: string,
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    source: "ANDROID",
    language: "EN",
    timezone: cfg.timeZone,
    version: "1.3.45",
    "Content-Type": "application/json",
  };
  if (token) headers.token = token;

  const response = await fetch(`${cfg.apiBase}${apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Petlibro API returned non-JSON for ${apiPath}`);
  }

  if (!response.ok) {
    throw new Error(`Petlibro HTTP ${response.status} for ${apiPath}`);
  }

  const code = typeof payload.code === "number" ? payload.code : -1;
  const msg = typeof payload.msg === "string" ? payload.msg : "Petlibro error";
  if (code !== 0) {
    return { ok: false, code, msg };
  }
  return { ok: true, data: (payload.data as Json) ?? {} };
}

async function login(cfg: PetlibroSession): Promise<string> {
  const password = cfg.password.trim();
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Petlibro passwords max ${PASSWORD_MAX_LENGTH} characters (same as the app).`,
    );
  }

  const result = await petlibroRequest(cfg, "/member/auth/login", {
    appId: APP_ID,
    appSn: APP_SN,
    country: cfg.region,
    email: cfg.email,
    password: hashPassword(password),
    phoneBrand: "",
    phoneSystemVersion: "",
    timezone: cfg.timeZone,
    thirdId: null,
    type: null,
  });

  if (!result.ok) {
    if (result.code === CODE_MEMBER_NOT_EXIST) {
      throw new Error(
        "Petlibro account not found. Create the account in the Petlibro mobile app (email + password), not the website, and not via Google Sign-In.",
      );
    }
    if (result.code === CODE_ILLEGAL_PASSWORD) {
      throw new Error(
        "Petlibro rejected the password. Use the email+password set in the Petlibro app (max 18 characters).",
      );
    }
    throw new Error(`${result.msg} (code ${result.code})`);
  }

  const data = asRecord(result.data);
  const token = str(data?.token);
  if (!token) throw new Error("Petlibro login succeeded but returned no token.");
  return token;
}

async function withToken<T>(
  cfg: PetlibroSession,
  run: (token: string) => Promise<T>,
): Promise<T> {
  let token = cfg.token;
  if (!token) {
    token = await login(cfg);
    await writeSession({ ...cfg, token, updatedAt: new Date().toISOString() });
  }

  try {
    return await run(token);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes(`code ${CODE_NOT_YET_LOGIN}`) && !message.includes("NOT_YET_LOGIN")) {
      throw e;
    }
  }

  token = await login(cfg);
  await writeSession({ ...cfg, token, updatedAt: new Date().toISOString() });
  return run(token);
}

async function apiData(
  cfg: PetlibroSession,
  token: string,
  apiPath: string,
  body: Record<string, unknown> = {},
): Promise<Json> {
  const result = await petlibroRequest(cfg, apiPath, body, token);
  if (!result.ok) {
    if (result.code === CODE_NOT_YET_LOGIN) {
      throw new Error(`NOT_YET_LOGIN (code ${CODE_NOT_YET_LOGIN})`);
    }
    throw new Error(`${result.msg} (code ${result.code})`);
  }
  return result.data;
}

async function postSerial(
  cfg: PetlibroSession,
  token: string,
  apiPath: string,
  deviceSn: string,
  extra: Record<string, unknown> = {},
): Promise<Json> {
  return apiData(cfg, token, apiPath, {
    id: deviceSn,
    deviceSn,
    ...extra,
  });
}

function listFromPayload(data: Json): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(asRecord).filter(Boolean) as Record<string, unknown>[];
  }
  const rec = asRecord(data);
  if (!rec) return [];
  for (const key of ["records", "list", "devices", "data"]) {
    const arr = asArray(rec[key])
      .map(asRecord)
      .filter(Boolean) as Record<string, unknown>[];
    if (arr.length) return arr;
  }
  return [];
}

function parseLastFeed(workRecord: Json): {
  lastFeedAt?: string;
  lastFeedPortions?: number;
} {
  const days = asArray(workRecord);
  for (const day of days) {
    const dayRec = asRecord(day);
    const records = asArray(dayRec?.workRecords);
    for (const record of records) {
      const r = asRecord(record);
      if (!r) continue;
      if (str(r.type) === "GRAIN_OUTPUT_SUCCESS") {
        const ms = num(r.recordTime);
        return {
          lastFeedAt: ms ? new Date(ms).toISOString() : undefined,
          lastFeedPortions: num(r.actualGrainNum),
        };
      }
    }
  }
  return {};
}

async function enrichDevice(
  cfg: PetlibroSession,
  token: string,
  device: Record<string, unknown>,
): Promise<PetlibroDeviceSnapshot> {
  const deviceSn = str(device.deviceSn) || str(device.id) || "";
  const productIdentifier = str(device.productIdentifier);
  const productName = str(device.productName);
  const kind = classifyDevice(productIdentifier, productName);
  const base: PetlibroDeviceSnapshot = {
    deviceSn,
    name: str(device.name) || productName || deviceSn || "Petlibro device",
    model: productIdentifier,
    modelName: productName,
    kind,
    online: boolish(device.online),
  };

  if (!deviceSn) return base;

  try {
    const realInfo = asRecord(await postSerial(cfg, token, "/device/device/realInfo", deviceSn));
    if (realInfo) {
      base.online = boolish(realInfo.online) ?? base.online;
    }

    if (kind === "feeder") {
      const grain = asRecord(
        await postSerial(cfg, token, "/device/data/grainStatus", deviceSn),
      );
      let workRecord: Json = [];
      try {
        const endTime = Date.now();
        const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
        workRecord = await apiData(cfg, token, "/device/workRecord/list", {
          deviceSn,
          startTime,
          endTime,
          size: 25,
          type: ["GRAIN_OUTPUT_SUCCESS"],
        });
      } catch {
        workRecord = [];
      }

      const portions = num(grain?.todayFeedingQuantity) ?? 0;
      const unitType = num(realInfo?.unitType) ?? 1;
      const converted = convertFeedPortions(portions, unitType);
      const surplus = realInfo?.surplusGrain;
      const foodLow =
        typeof surplus === "boolean"
          ? !surplus
          : typeof surplus === "number"
            ? surplus === 0
            : undefined;
      const last = parseLastFeed(workRecord);

      base.feeder = {
        todayFeedingTimes: num(grain?.todayFeedingTimes),
        todayFeedingQuantityPortions: portions,
        todayFeedingAmount: converted.amount,
        todayFeedingUnit: converted.unit,
        foodLow,
        ...last,
      };
    }

    if (kind === "fountain") {
      const drink = asRecord(
        await postSerial(cfg, token, "/data/deviceDrinkWater/todayDrinkData", deviceSn),
      );
      base.fountain = {
        todayDrinkMl: num(drink?.todayTotalMl),
        todayDrinkTimes: num(drink?.todayTotalTimes),
        todayDrinkSeconds: num(drink?.petEatingTime),
        yesterdayDrinkMl: num(drink?.yesterdayTotalMl),
        yesterdayDrinkTimes: num(drink?.yesterdayTotalTimes),
        waterLevelPercent: num(realInfo?.weightPercent),
        waterWeightG: num(realInfo?.weight),
      };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes(`code ${CODE_NOT_YET_LOGIN}`) || message.includes("NOT_YET_LOGIN")) {
      throw e;
    }
    // Keep base device even if enrichment fails for one endpoint.
  }

  return base;
}

export async function linkPetlibroAccount(input: PetlibroLinkInput): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const password = input.password.trim();
  if (!email || !email.includes("@")) {
    throw new Error("Petlibro email is required");
  }
  if (!password) {
    throw new Error("Petlibro password is required");
  }

  const cfg: PetlibroSession = {
    email,
    password,
    region: (input.region || process.env.PETLIBRO_REGION || "US").trim() || "US",
    apiBase: normalizeApiBase(
      process.env.PETLIBRO_API_BASE?.trim() || DEFAULT_API_BASE,
    ),
    timeZone: getDefaultTimeZone(),
  };

  const token = await login(cfg);
  await writeSession({
    ...cfg,
    token,
    updatedAt: new Date().toISOString(),
  });
}

export async function unlinkPetlibroAccount(): Promise<void> {
  await clearSession();
}

export async function fetchPetlibroSnapshot(): Promise<PetlibroSnapshot> {
  const cfg = await getPetlibroConfig();
  if (!cfg) {
    throw new Error("petlibro_not_configured");
  }

  return withToken(cfg, async (token) => {
    const listPayload = await apiData(cfg, token, "/device/device/list", {});
    const devicesRaw = listFromPayload(listPayload);
    const devices: PetlibroDeviceSnapshot[] = [];

    for (const device of devicesRaw) {
      devices.push(await enrichDevice(cfg, token, device));
    }

    const feeders = devices.filter((d) => d.kind === "feeder" && d.feeder);
    const fountains = devices.filter((d) => d.kind === "fountain" && d.fountain);

    let totalFoodPortionsToday = 0;
    let totalFoodAmountToday = 0;
    let totalFoodUnit: string | undefined;
    for (const d of feeders) {
      const f = d.feeder!;
      totalFoodPortionsToday += f.todayFeedingQuantityPortions ?? 0;
      totalFoodAmountToday += f.todayFeedingAmount ?? 0;
      totalFoodUnit = totalFoodUnit || f.todayFeedingUnit;
    }

    let totalWaterMlToday = 0;
    let totalWaterTimesToday = 0;
    for (const d of fountains) {
      const f = d.fountain!;
      totalWaterMlToday += f.todayDrinkMl ?? 0;
      totalWaterTimesToday += f.todayDrinkTimes ?? 0;
    }

    return {
      email: cfg.email,
      devices,
      totalFoodPortionsToday: feeders.length ? totalFoodPortionsToday : undefined,
      totalFoodAmountToday: feeders.length ? totalFoodAmountToday : undefined,
      totalFoodUnit: feeders.length ? totalFoodUnit : undefined,
      totalWaterMlToday: fountains.length ? totalWaterMlToday : undefined,
      totalWaterTimesToday: fountains.length ? totalWaterTimesToday : undefined,
      updatedAt: new Date().toISOString(),
    };
  });
}
