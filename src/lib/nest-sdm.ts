import {
  getGoogleAccessToken,
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
};

type NestStructuresResponse = {
  structures?: Array<{ name?: string }>;
};

type SdmErrorBody = { error?: { message?: string; status?: string } };

export type SdmFetchResult<T> = {
  ok: boolean;
  status: number;
  data: (T & SdmErrorBody) | null;
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

export function mapGoogleOAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("invalid_grant")) {
    return "Google refresh token rejected. Disconnect Google and link again.";
  }
  if (msg.includes("not linked")) {
    return "Google account not linked";
  }
  return msg || "google_oauth_error";
}

async function fetchSdmJson<T>(url: string, accessToken: string): Promise<SdmFetchResult<T>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  if (!text) return { ok: res.ok, status: res.status, data: null };
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) as T & SdmErrorBody };
  } catch {
    return { ok: res.ok, status: res.status, data: null };
  }
}

export function pickClimateDevice(list: NestDevice[]): NestDevice | null {
  const withClimate = list.filter((d) => {
    const c = d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
    const h = d.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
    return Number.isFinite(c) || Number.isFinite(h);
  });
  return withClimate[0] ?? null;
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

export { getGoogleAccessToken as getNestAccessToken };
