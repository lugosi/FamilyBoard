import { getGoogleRedirectUri, getNestPcmRedirectUri } from "@/lib/app-url";
import {
  GOOGLE_CALENDAR_SCOPES,
  getGoogleAccessToken,
  getNestProjectId,
  readGoogleTokens,
  requireGoogleOAuthEnv,
} from "@/lib/google";

export const NEST_API_VERSION = 4;
const SDM_SCOPE = "https://www.googleapis.com/auth/sdm.service";

export type NestDevice = {
  name?: string;
  type?: string;
  traits?: {
    "sdm.devices.traits.Info"?: { customName?: string };
    "sdm.devices.traits.Temperature"?: { ambientTemperatureCelsius?: number };
    "sdm.devices.traits.Humidity"?: { ambientHumidityPercent?: number };
  };
};

type NestDevicesResponse = {
  devices?: NestDevice[];
  nextPageToken?: string;
};

type NestStructuresResponse = {
  structures?: Array<{ name?: string }>;
  nextPageToken?: string;
};

type SdmErrorBody = { error?: { message?: string; status?: string; code?: number } };

export type SdmFetchResult<T> = {
  ok: boolean;
  status: number;
  data: (T & SdmErrorBody) | null;
  rawText?: string;
};

export type NestDeviceSummary = {
  name: string;
  type: string;
  customName: string | null;
  hasTemperature: boolean;
  hasHumidity: boolean;
  temperatureC: number | null;
  humidityPercent: number | null;
};

export type NestDiagnostic = {
  apiVersion: number;
  timestamp: string;
  config: {
    googleOAuthConfigured: boolean;
    nestProjectId: string | null;
    /** Masked GOOGLE_CLIENT_ID — compare to OAuth Client ID in Device Access project settings. */
    oauthClientIdMasked: string | null;
    googleLinked: boolean;
    hasRefreshToken: boolean;
    hasStoredAccessToken: boolean;
    accessTokenExpiry: number | null;
    requiredScopes: string[];
  };
  oauth: {
    ok: boolean;
    error: string | null;
    scopes: string[] | null;
    hasSdmScope: boolean | null;
  };
  sdm: {
    enterpriseId: string | null;
    structures: {
      url: string;
      status: number;
      ok: boolean;
      count: number;
      error: string | null;
    };
    devices: {
      url: string;
      status: number;
      ok: boolean;
      count: number;
      error: string | null;
    };
    deviceSummaries: NestDeviceSummary[];
    climateDeviceCount: number;
  };
  climate: {
    deviceName: string | null;
    temperatureF: number | null;
    humidity: number | null;
    hasData: boolean;
  };
  hints: string[];
  /** Open in browser to grant home/device access via Google Nest PCM (required for non-empty device list). */
  partnerConnectionsAuthUrl: string | null;
};

export function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

/** Google Nest Partner Connections Manager — grants home/device access for SDM. */
export function buildNestPartnerConnectionsAuthUrl(
  enterpriseId: string,
  clientId: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    client_id: clientId,
    response_type: "code",
    scope: SDM_SCOPE,
  });
  return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(enterpriseId)}/auth?${params.toString()}`;
}

function maskOAuthClientId(clientId: string | undefined): string | null {
  const id = clientId?.trim();
  if (!id) return null;
  if (id.length <= 16) return "***";
  return `${id.slice(0, 16)}…${id.slice(-12)}`;
}

export function mapGoogleOAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("invalid_grant")) {
    return "Google refresh token rejected (invalid_grant). Disconnect Google in FamilyBoard and link again.";
  }
  if (msg.includes("not linked")) {
    return "Google account not linked";
  }
  return msg || "google_oauth_error";
}

export async function readGoogleTokenScopes(accessToken: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { scope?: string };
    const raw = (data.scope ?? "").trim();
    if (!raw) return [];
    return raw.split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}

export async function fetchSdmJson<T>(url: string, accessToken: string): Promise<SdmFetchResult<T>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  if (!text) {
    return { ok: res.ok, status: res.status, data: null, rawText: "" };
  }
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: JSON.parse(text) as T & SdmErrorBody,
      rawText: text.length > 2000 ? `${text.slice(0, 2000)}…` : text,
    };
  } catch {
    return { ok: res.ok, status: res.status, data: null, rawText: text };
  }
}

export function summarizeNestDevice(d: NestDevice): NestDeviceSummary {
  const temp = d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
  const hum = d.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
  return {
    name: d.name ?? "",
    type: d.type ?? "unknown",
    customName: d.traits?.["sdm.devices.traits.Info"]?.customName ?? null,
    hasTemperature: Number.isFinite(temp),
    hasHumidity: Number.isFinite(hum),
    temperatureC: Number.isFinite(temp) ? Number(temp) : null,
    humidityPercent: Number.isFinite(hum) ? Number(hum) : null,
  };
}

export function pickClimateDevice(list: NestDevice[]): NestDevice | null {
  const withClimate = list.filter((d) => {
    const c = d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
    const h = d.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
    return Number.isFinite(c) || Number.isFinite(h);
  });
  return withClimate[0] ?? null;
}

export function buildNestHints(input: {
  hasSdmScope: boolean | null;
  structureCount: number;
  deviceCount: number;
  climateDeviceCount: number;
  deviceTypes: string[];
  oauthError: string | null;
  structuresError: string | null;
  devicesError: string | null;
  devicesStatus: number;
  nestProjectId: string | null;
  googleLinked: boolean;
}): string[] {
  const hints: string[] = [];
  if (!input.nestProjectId) {
    hints.push("Set GOOGLE_NEST_PROJECT_ID to the Device Access enterprise UUID (not the GCP project number).");
  } else if (/^\d+$/.test(input.nestProjectId)) {
    hints.push(
      "GOOGLE_NEST_PROJECT_ID looks like a numeric GCP project number. Replace it with the Device Access Project ID (UUID with dashes) from https://console.nest.google.com/device-access.",
    );
  } else if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.nestProjectId)
  ) {
    hints.push(
      "GOOGLE_NEST_PROJECT_ID should be a UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx from the Device Access console.",
    );
  }
  if (!input.googleLinked) {
    hints.push("Link Google via /api/auth/google (FamilyBoard → Link Google).");
  }
  if (input.oauthError) {
    hints.push(`OAuth: ${input.oauthError}`);
  }
  if (input.hasSdmScope === false) {
    hints.push(
      "Token missing sdm.service scope. Disconnect Google, then re-link so consent includes Nest Device Access.",
    );
  }
  if (input.devicesStatus === 401) {
    hints.push("SDM returned 401 — access token expired or revoked. Re-link Google.");
  }
  if (input.devicesStatus === 403) {
    hints.push(
      "SDM returned 403 — enable Smart Device Management API, complete Device Access, and authorize the linked Google account for this enterprise.",
    );
  }
  if (input.devicesStatus === 404) {
    hints.push(
      "SDM 404 Enterprise not found — your token is valid but this enterprise is not tied to GOOGLE_CLIENT_ID. In https://console.nest.google.com/device-access open THIS project (same UUID as GOOGLE_NEST_PROJECT_ID) → Project Information → OAuth Client ID must exactly match GOOGLE_CLIENT_ID in env (each Device Access project allows only one client id). If you created a new OAuth client in GCP, paste it into Device Access and re-link Google.",
    );
  }
  if (input.structuresError) {
    hints.push(`Structures: ${input.structuresError}`);
  }
  if (input.devicesError) {
    hints.push(`Devices: ${input.devicesError}`);
  }
  if (
    input.structureCount === 0 &&
    input.deviceCount === 0 &&
    !input.oauthError &&
    input.devicesStatus !== 401 &&
    input.devicesStatus !== 403 &&
    input.devicesStatus !== 404
  ) {
    hints.push(
      "HTTP 200 but zero structures/devices — complete Nest Partner Connections (PCM): open /api/auth/nest/pcm, use the SAME Google account as Link Google, turn ON your home and thermostat on the Nest permissions screen, then return to the board and refresh. Add {PUBLIC_APP_URL}/api/auth/nest/pcm/callback to OAuth redirect URIs. Thermostat must be in Google Home.",
    );
  }
  if (input.deviceCount > 0 && input.climateDeviceCount === 0) {
    hints.push(
      `Found ${input.deviceCount} device(s) but none expose Temperature/Humidity traits. Types: ${input.deviceTypes.join(", ") || "?"}. Confirm thermostat is on Google Home and migrated.`,
    );
  }
  if (input.deviceCount === 0 && input.structureCount > 0) {
    hints.push(
      "Structures exist but no devices — finish Google Home migration and ensure the thermostat is in the home tied to this account.",
    );
  }
  return hints;
}

export async function getNestAccessToken(
  redirectUri: string,
): Promise<{ token: string; scopes: string[] | null; hasSdmScope: boolean | null }> {
  try {
    const token = await getGoogleAccessToken(redirectUri);
    const scopes = await readGoogleTokenScopes(token);
    return {
      token,
      scopes,
      hasSdmScope: scopes?.includes(SDM_SCOPE) ?? null,
    };
  } catch (e) {
    throw new Error(mapGoogleOAuthError(e));
  }
}

function sdmEnterpriseBase(enterpriseId: string): string {
  return `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(enterpriseId)}`;
}

export async function fetchNestSdmState(
  accessToken: string,
  enterpriseId: string,
): Promise<{
  structures: SdmFetchResult<NestStructuresResponse>;
  devices: SdmFetchResult<NestDevicesResponse>;
  deviceList: NestDevice[];
}> {
  const structuresUrl = `${sdmEnterpriseBase(enterpriseId)}/structures`;
  const devicesUrl = `${sdmEnterpriseBase(enterpriseId)}/devices`;
  const structures = await fetchSdmJson<NestStructuresResponse>(structuresUrl, accessToken);
  const devicesResult = await fetchSdmJson<NestDevicesResponse>(devicesUrl, accessToken);
  return {
    structures,
    devices: devicesResult,
    deviceList: devicesResult.data?.devices ?? [],
  };
}

export async function runNestDiagnostics(request: Request): Promise<NestDiagnostic> {
  const timestamp = new Date().toISOString();
  const projectId = getNestProjectId();
  const clientIdForPcm = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const partnerConnectionsAuthUrl =
    projectId && clientIdForPcm
      ? buildNestPartnerConnectionsAuthUrl(
          projectId,
          clientIdForPcm,
          getNestPcmRedirectUri(request),
        )
      : null;
  let googleOAuthConfigured = false;
  try {
    requireGoogleOAuthEnv();
    googleOAuthConfigured = true;
  } catch {
    googleOAuthConfigured = false;
  }

  const stored = await readGoogleTokens();
  const oauthClientIdMasked = maskOAuthClientId(process.env.GOOGLE_CLIENT_ID);
  const config = {
    googleOAuthConfigured,
    nestProjectId: projectId,
    oauthClientIdMasked,
    googleLinked: Boolean(stored?.refresh_token),
    hasRefreshToken: Boolean(stored?.refresh_token),
    hasStoredAccessToken: Boolean(stored?.access_token),
    accessTokenExpiry: stored?.expiry_date ?? null,
    requiredScopes: GOOGLE_CALENDAR_SCOPES,
  };

  const hints = buildNestHints({
    hasSdmScope: null,
    structureCount: 0,
    deviceCount: 0,
    climateDeviceCount: 0,
    deviceTypes: [],
    oauthError: null,
    structuresError: null,
    devicesError: null,
    devicesStatus: 0,
    nestProjectId: projectId,
    googleLinked: config.googleLinked,
  });

  if (!googleOAuthConfigured) {
    return {
      apiVersion: NEST_API_VERSION,
      timestamp,
      config,
      oauth: { ok: false, error: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET", scopes: null, hasSdmScope: null },
      sdm: {
        enterpriseId: projectId,
        structures: { url: "", status: 0, ok: false, count: 0, error: "skipped" },
        devices: { url: "", status: 0, ok: false, count: 0, error: "skipped" },
        deviceSummaries: [],
        climateDeviceCount: 0,
      },
      climate: { deviceName: null, temperatureF: null, humidity: null, hasData: false },
      hints,
      partnerConnectionsAuthUrl,
    };
  }

  if (!projectId) {
    hints.unshift("Set GOOGLE_NEST_PROJECT_ID.");
    return {
      apiVersion: NEST_API_VERSION,
      timestamp,
      config,
      oauth: { ok: false, error: "GOOGLE_NEST_PROJECT_ID not set", scopes: null, hasSdmScope: null },
      sdm: {
        enterpriseId: null,
        structures: { url: "", status: 0, ok: false, count: 0, error: "skipped" },
        devices: { url: "", status: 0, ok: false, count: 0, error: "skipped" },
        deviceSummaries: [],
        climateDeviceCount: 0,
      },
      climate: { deviceName: null, temperatureF: null, humidity: null, hasData: false },
      hints,
      partnerConnectionsAuthUrl: null,
    };
  }

  const structuresUrl = `${sdmEnterpriseBase(projectId)}/structures`;
  const devicesUrl = `${sdmEnterpriseBase(projectId)}/devices`;

  if (!config.googleLinked) {
    const linkHints = buildNestHints({
      hasSdmScope: null,
      structureCount: 0,
      deviceCount: 0,
      climateDeviceCount: 0,
      deviceTypes: [],
      oauthError: "Google account not linked",
      structuresError: null,
      devicesError: null,
      devicesStatus: 0,
      nestProjectId: projectId,
      googleLinked: false,
    });
    return {
      apiVersion: NEST_API_VERSION,
      timestamp,
      config,
      oauth: { ok: false, error: "Google account not linked", scopes: null, hasSdmScope: null },
      sdm: {
        enterpriseId: projectId,
        structures: { url: structuresUrl, status: 0, ok: false, count: 0, error: "skipped" },
        devices: { url: devicesUrl, status: 0, ok: false, count: 0, error: "skipped" },
        deviceSummaries: [],
        climateDeviceCount: 0,
      },
      climate: { deviceName: null, temperatureF: null, humidity: null, hasData: false },
      hints: linkHints,
      partnerConnectionsAuthUrl,
    };
  }

  let token = "";
  let scopes: string[] | null = null;
  let hasSdmScope: boolean | null = null;
  let oauthError: string | null = null;
  try {
    const auth = await getNestAccessToken(getGoogleRedirectUri(request));
    token = auth.token;
    scopes = auth.scopes;
    hasSdmScope = auth.hasSdmScope;
  } catch (e) {
    oauthError = mapGoogleOAuthError(e);
  }

  if (!token) {
    const oauthHints = buildNestHints({
      hasSdmScope,
      structureCount: 0,
      deviceCount: 0,
      climateDeviceCount: 0,
      deviceTypes: [],
      oauthError,
      structuresError: null,
      devicesError: null,
      devicesStatus: 0,
      nestProjectId: projectId,
      googleLinked: true,
    });
    return {
      apiVersion: NEST_API_VERSION,
      timestamp,
      config,
      oauth: { ok: false, error: oauthError, scopes, hasSdmScope },
      sdm: {
        enterpriseId: projectId,
        structures: { url: structuresUrl, status: 0, ok: false, count: 0, error: "skipped" },
        devices: { url: devicesUrl, status: 0, ok: false, count: 0, error: "skipped" },
        deviceSummaries: [],
        climateDeviceCount: 0,
      },
      climate: { deviceName: null, temperatureF: null, humidity: null, hasData: false },
      hints: oauthHints,
      partnerConnectionsAuthUrl,
    };
  }

  const { structures, devices, deviceList } = await fetchNestSdmState(token, projectId);
  const summaries = deviceList.map(summarizeNestDevice);
  const climateDevice = pickClimateDevice(deviceList);
  const climateDeviceCount = deviceList.filter((d) => {
    const s = summarizeNestDevice(d);
    return s.hasTemperature || s.hasHumidity;
  }).length;

  const structuresError =
    structures.data?.error?.message ??
    (structures.ok ? null : structures.rawText?.slice(0, 200) ?? `HTTP ${structures.status}`);
  const devicesError =
    devices.data?.error?.message ??
    (devices.ok ? null : devices.rawText?.slice(0, 200) ?? `HTTP ${devices.status}`);

  const tempC = Number(
    climateDevice?.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius,
  );
  const humidity = Number(
    climateDevice?.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent,
  );
  const deviceName =
    climateDevice?.traits?.["sdm.devices.traits.Info"]?.customName ||
    climateDevice?.type ||
    null;

  const diagnosticHints = buildNestHints({
    hasSdmScope,
    structureCount: structures.data?.structures?.length ?? 0,
    deviceCount: deviceList.length,
    climateDeviceCount,
    deviceTypes: Array.from(new Set(deviceList.map((d) => d.type ?? "?"))),
    oauthError,
    structuresError,
    devicesError,
    devicesStatus: devices.status,
    nestProjectId: projectId,
    googleLinked: true,
  });

  return {
    apiVersion: NEST_API_VERSION,
    timestamp,
    config,
    oauth: { ok: true, error: null, scopes, hasSdmScope },
    sdm: {
      enterpriseId: projectId,
      structures: {
        url: structuresUrl,
        status: structures.status,
        ok: structures.ok,
        count: structures.data?.structures?.length ?? 0,
        error: structuresError,
      },
      devices: {
        url: devicesUrl,
        status: devices.status,
        ok: devices.ok,
        count: deviceList.length,
        error: devicesError,
      },
      deviceSummaries: summaries,
      climateDeviceCount,
    },
    climate: {
      deviceName,
      temperatureF: Number.isFinite(tempC) ? Math.round(cToF(tempC) * 10) / 10 : null,
      humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
      hasData: Number.isFinite(tempC) || Number.isFinite(humidity),
    },
    hints: diagnosticHints,
    partnerConnectionsAuthUrl,
  };
}
