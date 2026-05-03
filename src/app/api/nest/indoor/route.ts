import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getNestProjectId, getOAuth2WithRefresh, requireGoogleOAuthEnv } from "@/lib/google";

const NEST_INDOOR_API_VERSION = 3;

type NestDevice = {
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

function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

async function readGoogleTokenScopes(accessToken: string): Promise<string[] | null> {
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

type SdmErrorBody = { error?: { message?: string; status?: string } };

async function fetchSdmJson<T>(url: string, accessToken: string): Promise<{
  ok: boolean;
  status: number;
  data: (T & SdmErrorBody) | null;
}> {
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

/** Device Access list endpoints: call without pagination params (some enterprises reject `pageSize`). */
async function listNestStructures(
  accessToken: string,
  enterpriseId: string,
): Promise<Array<{ name?: string }>> {
  const base = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(enterpriseId)}/structures`;
  const out = await fetchSdmJson<NestStructuresResponse>(base, accessToken);
  if (!out.ok) return [];
  return out.data?.structures ?? [];
}

export async function GET(request: Request) {
  try {
    requireGoogleOAuthEnv();
  } catch {
    return NextResponse.json(
      { error: "Google OAuth not configured", apiVersion: NEST_INDOOR_API_VERSION },
      { status: 501 },
    );
  }
  const projectId = getNestProjectId();
  if (!projectId) {
    return NextResponse.json(
      { error: "Set GOOGLE_NEST_PROJECT_ID", apiVersion: NEST_INDOOR_API_VERSION },
      { status: 501 },
    );
  }

  try {
    const oauth2 = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const accessToken = await oauth2.getAccessToken();
    const token = accessToken.token?.trim();
    if (!token) {
      return NextResponse.json(
        { error: "Google token unavailable. Re-link Google.", apiVersion: NEST_INDOOR_API_VERSION },
        { status: 401 },
      );
    }

    const scopes = await readGoogleTokenScopes(token);
    const hasSdmScope = scopes?.includes("https://www.googleapis.com/auth/sdm.service") ?? null;

    const structures = await listNestStructures(token, projectId);

    const devicesUrl = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(projectId)}/devices`;
    const devicesResult = await fetchSdmJson<NestDevicesResponse>(devicesUrl, token);

    if (devicesResult.status === 401) {
      return NextResponse.json(
        { error: "Google link expired. Re-link Google.", apiVersion: NEST_INDOOR_API_VERSION },
        { status: 401 },
      );
    }
    if (devicesResult.status === 403) {
      return NextResponse.json(
        {
          error:
            "Nest access forbidden. Confirm Device Access is enabled and re-link Google to grant thermostat scope.",
          detail: devicesResult.data?.error?.message ?? null,
          apiVersion: NEST_INDOOR_API_VERSION,
        },
        { status: 403 },
      );
    }
    if (!devicesResult.ok) {
      return NextResponse.json(
        {
          error: "Failed to read Nest devices",
          detail: devicesResult.data?.error?.message ?? null,
          apiVersion: NEST_INDOOR_API_VERSION,
        },
        { status: 502 },
      );
    }

    const devices = devicesResult.data?.devices ?? [];

    function pickClimateDevice(list: NestDevice[]): NestDevice | null {
      const withClimate = list.filter((d) => {
        const c = d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
        const h = d.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
        return Number.isFinite(c) || Number.isFinite(h);
      });
      if (withClimate.length > 0) return withClimate[0]!;
      return null;
    }

    const withClimate = pickClimateDevice(devices);
    if (!withClimate) {
      const types = Array.from(new Set(devices.map((d) => d.type ?? "?")));
      const scopeHint =
        hasSdmScope === false
          ? " Your Google token is missing https://www.googleapis.com/auth/sdm.service — disconnect Google in FamilyBoard and link again (OAuth consent must include Nest)."
          : "";
      const structureHint =
        structures.length === 0 && devices.length === 0
          ? " Nest SDM returned zero structures and zero devices — usually wrong GOOGLE_NEST_PROJECT_ID, wrong Google Cloud project linked to Device Access, or the linked Google account is not authorized for this Device Access project."
          : "";
      const hint =
        devices.length === 0
          ? ` Nest SDM returned zero devices (${structures.length} structure(s) visible). Confirm GOOGLE_NEST_PROJECT_ID matches Device Access, migration to Google Home is complete, and you re-linked Google after enabling Nest scope.${structureHint}${scopeHint}`
          : ` Nest SDM listed ${devices.length} device(s) but none reported Temperature/Humidity traits yet (types: ${types.slice(0, 8).join(", ")}${types.length > 8 ? ", …" : ""}).${scopeHint}`;
      return NextResponse.json(
        {
          temperatureF: null,
          humidity: null,
          deviceName: null,
          hasData: false,
          error: `No Nest thermostat climate data found.${hint}`,
          diagnostic: {
            structureCount: structures.length,
            deviceCount: devices.length,
            hasSdmScope,
          },
          apiVersion: NEST_INDOOR_API_VERSION,
        },
        { status: 200 },
      );
    }

    const tempC = Number(withClimate.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius);
    const humidity = Number(withClimate.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent);
    const name =
      withClimate.traits?.["sdm.devices.traits.Info"]?.customName ||
      withClimate.type ||
      "Nest device";

    return NextResponse.json({
      temperatureF: Number.isFinite(tempC) ? Math.round(cToF(tempC) * 10) / 10 : null,
      humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
      deviceName: name,
      hasData: Number.isFinite(tempC) || Number.isFinite(humidity),
      apiVersion: NEST_INDOOR_API_VERSION,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "nest_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message, apiVersion: NEST_INDOOR_API_VERSION }, { status });
  }
}
