import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getNestProjectId, getOAuth2WithRefresh, requireGoogleOAuthEnv } from "@/lib/google";

const NEST_INDOOR_API_VERSION = 2;

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

async function listAllNestStructures(
  accessToken: string,
  enterpriseId: string,
): Promise<Array<{ name?: string }>> {
  const structures: Array<{ name?: string }> = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams();
    qs.set("pageSize", "100");
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await fetch(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(enterpriseId)}/structures?${qs.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    const text = await res.text().catch(() => "");
    let pageData = {} as NestStructuresResponse & { error?: { message?: string } };
    try {
      pageData = text ? (JSON.parse(text) as typeof pageData) : {};
    } catch {
      return structures;
    }
    if (!res.ok) return structures;
    structures.push(...(pageData.structures ?? []));
    pageToken = pageData.nextPageToken;
  } while (pageToken && structures.length < 500);
  return structures;
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

    const structures = (await listAllNestStructures(token, projectId)) ?? [];

    const devices: NestDevice[] = [];
    let pageToken: string | undefined;
    let parseError: string | null = null;
    do {
      const qs = new URLSearchParams();
      qs.set("pageSize", "100");
      if (pageToken) qs.set("pageToken", pageToken);
      const res = await fetch(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(projectId)}/devices?${qs.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const text = await res.text().catch(() => "");
      let pageData = {} as NestDevicesResponse & { error?: { message?: string } };
      try {
        pageData = text ? (JSON.parse(text) as typeof pageData) : {};
      } catch {
        parseError = "invalid_json_response";
        break;
      }
      if (res.status === 401) {
        return NextResponse.json(
          { error: "Google link expired. Re-link Google.", apiVersion: NEST_INDOOR_API_VERSION },
          { status: 401 },
        );
      }
      if (res.status === 403) {
        return NextResponse.json(
          {
            error:
              "Nest access forbidden. Confirm Device Access is enabled and re-link Google to grant thermostat scope.",
            detail: pageData?.error?.message ?? null,
            apiVersion: NEST_INDOOR_API_VERSION,
          },
          { status: 403 },
        );
      }
      if (!res.ok) {
        return NextResponse.json(
          {
            error: "Failed to read Nest devices",
            detail: pageData?.error?.message ?? null,
            apiVersion: NEST_INDOOR_API_VERSION,
          },
          { status: 502 },
        );
      }

      devices.push(...(pageData.devices ?? []));
      pageToken = pageData.nextPageToken;
    } while (pageToken && devices.length < 500);

    if (parseError) {
      return NextResponse.json(
        { error: "Failed to parse Nest API response", apiVersion: NEST_INDOOR_API_VERSION },
        { status: 502 },
      );
    }

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
