import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { encryptCatlinkPassword, signCatlinkParameters } from "./catlink-crypto";

const SESSION_FILE = "catlink-session.json";
const RETURN_CODE_TOKEN_EXPIRED = 1002;
const RETURN_CODE_WRONG_PASSWORD = 2002;
const PASSWORD_MAX_LENGTH = 16;

const API_USA = "https://app-usa.catlinks.cn/api/";

/** CatLink cloud regions (same set as hasscc/catlink). */
const CATLINK_API_REGIONS = [
  API_USA,
  "https://app.catlinks.cn/api/",
  "https://app-sh.catlinks.cn/api/",
  "https://app-sgp.catlinks.cn/api/",
] as const;

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
  password?: string;
  apiBase: string;
  deviceId?: string;
  language: string;
};

type CatlinkSession = {
  token?: string;
  phone?: string;
  phoneIac?: string;
  apiBase?: string;
  updatedAt?: string;
};

export type CatlinkLinkInput = {
  phone: string;
  phoneIac?: string;
  password: string;
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

function normalizeApiBase(raw: string): string {
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** Split a phone field into CatLink internationalCode + national mobile number. */
function parsePhoneInput(
  raw: string,
  defaultIac = "1",
): { phoneIac: string; mobile: string } {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return { phoneIac: defaultIac, mobile: "" };
  }

  if (trimmed.startsWith("+")) {
    if (digits.startsWith("1") && digits.length === 11) {
      return { phoneIac: "1", mobile: digits.slice(1) };
    }
    if (digits.startsWith("86") && digits.length >= 11) {
      return { phoneIac: "86", mobile: digits.slice(2) };
    }
    for (const len of [3, 2, 1]) {
      if (digits.length > len + 6) {
        return { phoneIac: digits.slice(0, len), mobile: digits.slice(len) };
      }
    }
  }

  // US/Canada: 11 digits starting with 1 when country code omitted
  if (digits.length === 11 && digits.startsWith("1")) {
    return { phoneIac: "1", mobile: digits.slice(1) };
  }

  return { phoneIac: defaultIac, mobile: digits };
}

function buildBaseConfig(
  phone: string,
  phoneIac: string,
  apiBase?: string,
): Omit<CatlinkConfig, "password"> {
  const apiBaseRaw =
    apiBase?.trim() || process.env.CATLINK_API_BASE?.trim() || API_USA;
  return {
    phone,
    phoneIac,
    apiBase: normalizeApiBase(apiBaseRaw),
    deviceId: process.env.CATLINK_DEVICE_ID?.trim() || undefined,
    language: process.env.CATLINK_LANGUAGE?.trim() || "en_US",
  };
}

function loginApiBases(): string[] {
  const envBase = process.env.CATLINK_API_BASE?.trim();
  const normalizedEnv = envBase ? normalizeApiBase(envBase) : null;
  const bases = normalizedEnv ? [normalizedEnv] : [];
  for (const base of CATLINK_API_REGIONS) {
    if (!bases.includes(base)) bases.push(base);
  }
  return bases;
}

const LOGIN_API_PATHS = ["login/password", "login/password/v2"] as const;

function loginErrorMessage(rsp: Record<string, unknown>): string {
  const msg = typeof rsp.msg === "string" ? rsp.msg : "Login failed";
  const code = typeof rsp.returnCode === "number" ? rsp.returnCode : undefined;

  if (code === RETURN_CODE_WRONG_PASSWORD) {
    return [
      "CatLink recognized your phone number but rejected the password.",
      "In the CatLink app: log out, choose phone + password login (not SMS), and confirm the password works there first.",
      "Then set a new short password (8–12 letters/numbers) under Account → Security, log out again, and link here.",
      "Only one session is allowed — stay logged out of the app while linking.",
    ].join(" ");
  }
  if (code === 1001 && msg.toLowerCase().includes("null input")) {
    return "CatLink rejected the login request. Try a shorter password (8–16 characters) and link again.";
  }

  return code != null ? `${msg} (code ${code})` : msg;
}

type LoginAttempt =
  | { ok: true; token: string; apiBase: string }
  | { ok: false; returnCode?: number; msg: string };

async function attemptPasswordLogin(
  apiBase: string,
  phoneIac: string,
  mobile: string,
  plainPassword: string,
): Promise<LoginAttempt> {
  const cfg = buildBaseConfig(mobile, phoneIac, apiBase);
  const trimmed = plainPassword.trim();
  const password =
    trimmed.length <= PASSWORD_MAX_LENGTH
      ? encryptCatlinkPassword(trimmed)
      : trimmed;

  let sawWrongPassword = false;
  let lastMsg = "Login failed";

  for (const loginPath of LOGIN_API_PATHS) {
    let rsp: Record<string, unknown>;
    try {
      rsp = await catlinkRequest(cfg, undefined, loginPath, "POST", {
        platform: "ANDROID",
        internationalCode: phoneIac,
        mobile,
        password,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "CatLink request failed";
      return { ok: false, msg: message };
    }

    const token = (rsp.data as { token?: string } | undefined)?.token;
    if (token) {
      return { ok: true, token, apiBase: cfg.apiBase };
    }

    const returnCode =
      typeof rsp.returnCode === "number" ? rsp.returnCode : undefined;
    lastMsg = loginErrorMessage(rsp);
    if (returnCode === RETURN_CODE_WRONG_PASSWORD) {
      sawWrongPassword = true;
      continue;
    }
  }

  return {
    ok: false,
    returnCode: sawWrongPassword ? RETURN_CODE_WRONG_PASSWORD : undefined,
    msg: lastMsg,
  };
}

export async function isCatlinkLinked(): Promise<boolean> {
  const session = await readSession();
  return Boolean(session?.token);
}

export async function getCatlinkConfig(): Promise<CatlinkConfig | null> {
  const session = await readSession();
  const envPhoneRaw = process.env.CATLINK_PHONE?.trim();
  const envPassword = process.env.CATLINK_PASSWORD?.trim();
  const defaultIac =
    session?.phoneIac?.trim() ||
    process.env.CATLINK_PHONE_IAC?.trim() ||
    "1";

  let phone: string;
  let phoneIac: string;

  if (session?.phone) {
    phone = session.phone;
    phoneIac = defaultIac;
  } else if (envPhoneRaw) {
    const parsed = parsePhoneInput(envPhoneRaw, defaultIac);
    phone = parsed.mobile;
    phoneIac = parsed.phoneIac;
  } else {
    return null;
  }

  if (!phone) return null;

  if (!session?.token && !envPassword) return null;

  return {
    ...buildBaseConfig(phone, phoneIac, session?.apiBase),
    password: envPassword || undefined,
  };
}

export function getCatlinkEnvReady(): boolean {
  const phoneRaw = process.env.CATLINK_PHONE?.trim();
  const password = process.env.CATLINK_PASSWORD?.trim();
  return Boolean(phoneRaw && password);
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

async function clearSession(): Promise<void> {
  const file = path.join(getDataDir(), SESSION_FILE);
  try {
    await fs.unlink(file);
  } catch {
    /* noop */
  }
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

async function loginWithPassword(cfg: CatlinkConfig, plainPassword: string): Promise<string> {
  const result = await attemptPasswordLogin(
    cfg.apiBase,
    cfg.phoneIac,
    cfg.phone,
    plainPassword,
  );
  if (!result.ok) {
    throw new Error(result.msg);
  }

  await writeSession({
    token: result.token,
    phone: cfg.phone,
    phoneIac: cfg.phoneIac,
    apiBase: result.apiBase,
    updatedAt: new Date().toISOString(),
  });
  return result.token;
}

async function getToken(cfg: CatlinkConfig): Promise<string> {
  const session = await readSession();
  if (session?.token) return session.token;
  if (!cfg.password) {
    throw new Error("Catlink session expired. Link Catlink again from the board.");
  }
  return loginWithPassword(cfg, cfg.password);
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
    if (!cfg.password) {
      await clearSession();
      throw new Error("Catlink session expired. Link Catlink again from the board.");
    }
    token = await loginWithPassword(cfg, cfg.password);
    rsp = await catlinkRequest(cfg, token, apiPath, method, params);
  }
  return rsp;
}

export async function linkCatlinkAccount(input: CatlinkLinkInput): Promise<void> {
  const defaultIac =
    input.phoneIac?.trim() ||
    process.env.CATLINK_PHONE_IAC?.trim() ||
    "1";
  const { phoneIac, mobile } = parsePhoneInput(input.phone, defaultIac);
  if (!mobile) {
    throw new Error("Phone number is required");
  }
  const password = input.password.trim();
  if (!password) {
    throw new Error("Password is required");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Catlink passwords must be ${PASSWORD_MAX_LENGTH} characters or fewer`);
  }

  let lastError = "Login failed on all CatLink regions";

  for (const apiBase of loginApiBases()) {
    const result = await attemptPasswordLogin(
      apiBase,
      phoneIac,
      mobile,
      password,
    );
    if (result.ok) {
      await writeSession({
        token: result.token,
        phone: mobile,
        phoneIac,
        apiBase: result.apiBase,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (result.returnCode === RETURN_CODE_WRONG_PASSWORD) {
      throw new Error(result.msg);
    }
    lastError = result.msg;
  }

  throw new Error(
    `${lastError}. Check your phone number (e.g. 4244420566 or +1 424 442 0566) and CatLink app password.`,
  );
}

export async function unlinkCatlinkAccount(): Promise<void> {
  await clearSession();
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
  const cfg = await getCatlinkConfig();
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
  const cfg = await getCatlinkConfig();
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
