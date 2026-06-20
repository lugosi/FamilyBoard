import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { encryptCatlinkPassword, signCatlinkParameters } from "./catlink-crypto";

const SESSION_FILE = "catlink-session.json";
const RETURN_CODE_TOKEN_EXPIRED = 1002;
const PASSWORD_MAX_LENGTH = 16;

const API_USA = "https://app-usa.catlinks.cn/api/";

export type CatlinkAction =
  | "clean_now"
  | "toggle_child_lock"
  | "toggle_odor_control"
  | "toggle_night_light";

export type CatlinkSnapshot = {
  deviceId: string;
  deviceName: string;
  model?: string;
  deviceType?: string;
  online?: boolean;
  litterLevelPercent?: number;
  weightKg?: number;
  cleanCyclesToday?: number;
  childLock?: boolean;
  odorControl?: boolean;
  nightLight?: boolean;
  lastCleanedAt?: string;
  workStatus?: string;
  workMode?: string;
  updatedAt?: string;
};

type CatlinkConfig = {
  phone: string;
  phoneIac: string;
  password: string;
  apiBase: string;
  deviceId?: string;
  language: string;
};

type CatlinkSession = {
  token?: string;
  updatedAt?: string;
};

type CatlinkDeviceListItem = {
  id?: string;
  mac?: string;
  model?: string;
  deviceType?: string;
  deviceName?: string;
  currentErrorMessage?: string;
};

type DeviceApiKind = "scooper" | "litterbox" | "c08";

type DeviceInfo = Record<string, unknown>;

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function getCatlinkConfig(): CatlinkConfig | null {
  const phoneRaw = process.env.CATLINK_PHONE?.trim();
  const password = process.env.CATLINK_PASSWORD?.trim();
  if (!phoneRaw || !password) return null;

  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;

  const apiBaseRaw = process.env.CATLINK_API_BASE?.trim() || API_USA;
  const apiBase = apiBaseRaw.endsWith("/") ? apiBaseRaw : `${apiBaseRaw}/`;

  return {
    phone,
    phoneIac: process.env.CATLINK_PHONE_IAC?.trim() || "1",
    password,
    apiBase,
    deviceId: process.env.CATLINK_DEVICE_ID?.trim() || undefined,
    language: process.env.CATLINK_LANGUAGE?.trim() || "en_US",
  };
}

async function readSession(): Promise<CatlinkSession | null> {
  const file = path.join(getDataDir(), SESSION_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as CatlinkSession;
  } catch {
    return null;
  }
}

async function writeSession(session: CatlinkSession): Promise<void> {
  const file = path.join(getDataDir(), SESSION_FILE);
  await fs.writeFile(file, JSON.stringify(session, null, 2), "utf-8");
}

function apiUrl(cfg: CatlinkConfig, apiPath: string): string {
  return `${cfg.apiBase}${apiPath.replace(/^\//, "")}`;
}

function prepareParams(
  params: Record<string, string | number | boolean>,
  token?: string,
): Record<string, string> {
  const prepared: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    prepared[key] = String(value);
  }
  prepared.noncestr = String(Date.now());
  if (token) prepared.token = token;
  prepared.sign = signCatlinkParameters(prepared);
  return prepared;
}

async function catlinkRequest(
  cfg: CatlinkConfig,
  token: string | undefined,
  apiPath: string,
  method: "GET" | "POST",
  params: Record<string, string | number | boolean> = {},
): Promise<Record<string, unknown>> {
  const prepared = prepareParams(params, token);
  const headers: Record<string, string> = {
    language: cfg.language,
    "User-Agent": "CATLINK/4.1.5 (iPhone; iOS 26.2.1; Scale/3.00)",
    app_version: "4.1.5",
    system_version: "26.2.1",
    token: token ?? "",
  };

  let response: Response;
  if (method === "GET") {
    const url = new URL(apiUrl(cfg, apiPath));
    for (const [key, value] of Object.entries(prepared)) {
      url.searchParams.set(key, value);
    }
    response = await fetch(url, { headers, cache: "no-store" });
  } else {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(prepared)) {
      body.set(key, value);
    }
    response = await fetch(apiUrl(cfg, apiPath), {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Catlink API returned non-JSON for ${apiPath}`);
  }
  return data;
}

async function login(cfg: CatlinkConfig): Promise<string> {
  const password =
    cfg.password.length <= PASSWORD_MAX_LENGTH
      ? encryptCatlinkPassword(cfg.password)
      : cfg.password;

  const rsp = await catlinkRequest(cfg, undefined, "login/password", "POST", {
    platform: "ANDROID",
    internationalCode: cfg.phoneIac,
    mobile: cfg.phone,
    password,
  });

  const token = (rsp.data as { token?: string } | undefined)?.token;
  if (!token) {
    const msg = typeof rsp.msg === "string" ? rsp.msg : "Login failed";
    throw new Error(msg);
  }

  await writeSession({ token, updatedAt: new Date().toISOString() });
  return token;
}

async function getToken(cfg: CatlinkConfig): Promise<string> {
  const session = await readSession();
  if (session?.token) return session.token;
  return login(cfg);
}

async function requestWithAuth(
  cfg: CatlinkConfig,
  apiPath: string,
  method: "GET" | "POST",
  params: Record<string, string | number | boolean> = {},
): Promise<Record<string, unknown>> {
  let token = await getToken(cfg);
  let rsp = await catlinkRequest(cfg, token, apiPath, method, params);
  if (rsp.returnCode === RETURN_CODE_TOKEN_EXPIRED) {
    token = await login(cfg);
    rsp = await catlinkRequest(cfg, token, apiPath, method, params);
  }
  return rsp;
}

function assertSuccess(rsp: Record<string, unknown>, action: string): void {
  const code = typeof rsp.returnCode === "number" ? rsp.returnCode : 0;
  if (code !== 0) {
    const msg = typeof rsp.msg === "string" ? rsp.msg : `${action} failed`;
    throw new Error(msg);
  }
}

function classifyDevice(device: CatlinkDeviceListItem): DeviceApiKind {
  const type = (device.deviceType ?? "").toUpperCase();
  if (type === "C08" || type === "LITTER_BOX_599") return "c08";
  if (type.includes("LITTER")) return "litterbox";
  return "scooper";
}

function infoApiPath(kind: DeviceApiKind): string {
  if (kind === "c08") return "token/litterbox/info/c08";
  if (kind === "litterbox") return "token/litterbox/info";
  return "token/device/info";
}

function logsApiPath(kind: DeviceApiKind): string | null {
  if (kind === "c08" || kind === "litterbox") {
    return "token/litterbox/stats/log/top5";
  }
  return "token/device/scooper/stats/log/top5";
}

function logsKey(kind: DeviceApiKind): string {
  return kind === "scooper" ? "scooperLogTop5" : "scooperLogTop5";
}

async function listDevices(cfg: CatlinkConfig): Promise<CatlinkDeviceListItem[]> {
  const rsp = await requestWithAuth(cfg, "token/device/union/list/sorted", "GET", {
    type: "NONE",
  });
  assertSuccess(rsp, "List devices");
  const data = rsp.data as { devices?: CatlinkDeviceListItem[] } | undefined;
  return data?.devices ?? [];
}

function pickDevice(
  devices: CatlinkDeviceListItem[],
  cfg: CatlinkConfig,
): CatlinkDeviceListItem {
  const litterDevices = devices.filter((d) => {
    const type = (d.deviceType ?? "").toUpperCase();
    const model = (d.model ?? "").toUpperCase();
    return (
      type.includes("SCOOPER") ||
      type.includes("LITTER") ||
      type === "C08" ||
      model.includes("SCOOPER") ||
      model.includes("LITTER")
    );
  });
  const pool = litterDevices.length > 0 ? litterDevices : devices;

  if (cfg.deviceId) {
    const match = pool.find((d) => d.id === cfg.deviceId);
    if (match) return match;
  }

  const seMatch = pool.find((d) => (d.model ?? "").toUpperCase().includes("SE"));
  if (seMatch) return seMatch;

  if (pool.length === 0) {
    throw new Error("No Catlink devices found on this account");
  }
  return pool[0];
}

async function fetchDeviceInfo(
  cfg: CatlinkConfig,
  deviceId: string,
  kind: DeviceApiKind,
): Promise<DeviceInfo> {
  const rsp = await requestWithAuth(cfg, infoApiPath(kind), "GET", {
    deviceId,
  });
  assertSuccess(rsp, "Fetch device info");
  const data = rsp.data as { deviceInfo?: DeviceInfo } | undefined;
  return data?.deviceInfo ?? {};
}

async function fetchRecentLogTime(
  cfg: CatlinkConfig,
  deviceId: string,
  kind: DeviceApiKind,
): Promise<string | undefined> {
  const api = logsApiPath(kind);
  if (!api) return undefined;
  const rsp = await requestWithAuth(cfg, api, "GET", { deviceId });
  if (rsp.returnCode !== 0) return undefined;
  const data = rsp.data as Record<string, unknown> | undefined;
  const logs = data?.[logsKey(kind)];
  if (!Array.isArray(logs) || logs.length === 0) return undefined;
  const first = logs[0] as { time?: string };
  return typeof first.time === "string" ? first.time : undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "01" || value === "1" || value === 1 || value === true) return true;
  if (value === "00" || value === "0" || value === 0 || value === false) return false;
  if (value === "LOCKED") return true;
  if (value === "UNLOCKED") return false;
  if (value === "ALWAYS_OPEN") return true;
  if (value === "CLOSED") return false;
  return undefined;
}

function mapSnapshot(
  device: CatlinkDeviceListItem,
  detail: DeviceInfo,
  lastCleanedAt?: string,
): CatlinkSnapshot {
  const litterCountdown = toNumber(detail.litterCountdown);
  const catLitterBalance = toNumber(detail.catLitterBalance);
  const inductionTimes = toNumber(detail.inductionTimes) ?? 0;
  const manualTimes = toNumber(detail.manualTimes) ?? 0;

  let litterLevelPercent: number | undefined;
  if (catLitterBalance !== null) {
    litterLevelPercent = Math.max(0, Math.min(100, Math.round(catLitterBalance)));
  } else if (litterCountdown !== null && litterCountdown > 0) {
    litterLevelPercent = Math.max(0, Math.min(100, Math.round((litterCountdown / 30) * 100)));
  }

  const weightKg =
    toNumber(detail.weight) ??
    toNumber(detail.catLitterWeight) ??
    undefined;

  return {
    deviceId: device.id ?? "",
    deviceName: device.deviceName ?? "Catlink",
    model: typeof device.model === "string" ? device.model : undefined,
    deviceType: typeof device.deviceType === "string" ? device.deviceType : undefined,
    online: toBool(detail.online),
    litterLevelPercent,
    weightKg: weightKg ?? undefined,
    cleanCyclesToday: inductionTimes + manualTimes,
    childLock: toBool(detail.keyLock),
    odorControl: toBool(detail.deodorantEnable),
    nightLight: toBool(detail.indicatorLight),
    lastCleanedAt,
    workStatus: typeof detail.workStatus === "string" ? detail.workStatus : undefined,
    workMode: typeof detail.workModel === "string" ? detail.workModel : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchCatlinkSnapshot(): Promise<CatlinkSnapshot> {
  const cfg = getCatlinkConfig();
  if (!cfg) {
    throw new Error("catlink_not_configured");
  }

  const devices = await listDevices(cfg);
  const device = pickDevice(devices, cfg);
  if (!device.id) {
    throw new Error("Selected Catlink device has no id");
  }

  const kind = classifyDevice(device);
  const [detail, lastCleanedAt] = await Promise.all([
    fetchDeviceInfo(cfg, device.id, kind),
    fetchRecentLogTime(cfg, device.id, kind),
  ]);

  return mapSnapshot(device, detail, lastCleanedAt);
}

async function runCleanNow(
  cfg: CatlinkConfig,
  deviceId: string,
  kind: DeviceApiKind,
): Promise<void> {
  if (kind === "c08") {
    const rsp = await requestWithAuth(cfg, "token/litterbox/actionCmd/v3", "POST", {
      deviceId,
      action: "RUN",
      behavior: "CLEAN",
    });
    assertSuccess(rsp, "Clean now");
    return;
  }
  if (kind === "litterbox") {
    const rsp = await requestWithAuth(cfg, "token/litterbox/actionCmd", "POST", {
      deviceId,
      cmd: "01",
    });
    assertSuccess(rsp, "Clean now");
    return;
  }
  const rsp = await requestWithAuth(cfg, "token/device/actionCmd", "POST", {
    deviceId,
    cmd: "01",
  });
  assertSuccess(rsp, "Clean now");
}

async function toggleChildLock(
  cfg: CatlinkConfig,
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  const rsp = await requestWithAuth(cfg, "token/litterbox/keyLock", "POST", {
    deviceId,
    lockStatus: enabled ? "01" : "00",
  });
  assertSuccess(rsp, "Toggle child lock");
}

async function toggleOdorControl(
  cfg: CatlinkConfig,
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  const rsp = await requestWithAuth(cfg, "token/litterbox/deepClean/autoBurial", "POST", {
    deviceId,
    enable: enabled ? "1" : "0",
  });
  if (rsp.returnCode === 0) return;
  throw new Error(
    typeof rsp.msg === "string"
      ? rsp.msg
      : "Odor control is not supported on this device model",
  );
}

async function toggleNightLight(
  cfg: CatlinkConfig,
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  const rsp = await requestWithAuth(cfg, "token/litterbox/indicatorLightSetting", "POST", {
    deviceId,
    status: enabled ? "ALWAYS_OPEN" : "CLOSED",
  });
  assertSuccess(rsp, "Toggle night light");
}

export async function executeCatlinkAction(action: CatlinkAction): Promise<void> {
  const cfg = getCatlinkConfig();
  if (!cfg) {
    throw new Error("catlink_not_configured");
  }

  const devices = await listDevices(cfg);
  const device = pickDevice(devices, cfg);
  if (!device.id) {
    throw new Error("Selected Catlink device has no id");
  }
  const kind = classifyDevice(device);
  const snapshot = await fetchDeviceInfo(cfg, device.id, kind);

  switch (action) {
    case "clean_now":
      await runCleanNow(cfg, device.id, kind);
      return;
    case "toggle_child_lock":
      await toggleChildLock(cfg, device.id, !toBool(snapshot.keyLock));
      return;
    case "toggle_odor_control":
      await toggleOdorControl(cfg, device.id, !toBool(snapshot.deodorantEnable));
      return;
    case "toggle_night_light":
      await toggleNightLight(cfg, device.id, !toBool(snapshot.indicatorLight));
      return;
    default:
      throw new Error("Unsupported action");
  }
}
