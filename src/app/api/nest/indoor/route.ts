import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getNestProjectId, requireGoogleOAuthEnv } from "@/lib/google";
import {
  NEST_API_VERSION,
  buildNestHints,
  cToF,
  fetchNestSdmState,
  getNestAccessToken,
  mapGoogleOAuthError,
  pickClimateDevice,
} from "@/lib/nest-sdm";

export async function GET(request: Request) {
  try {
    requireGoogleOAuthEnv();
  } catch {
    return NextResponse.json(
      { error: "Google OAuth not configured", apiVersion: NEST_API_VERSION },
      { status: 501 },
    );
  }
  const projectId = getNestProjectId();
  if (!projectId) {
    return NextResponse.json(
      { error: "Set GOOGLE_NEST_PROJECT_ID", apiVersion: NEST_API_VERSION },
      { status: 501 },
    );
  }

  try {
    const { token, hasSdmScope } = await getNestAccessToken(getGoogleRedirectUri(request));
    const { structures, devices, deviceList } = await fetchNestSdmState(token, projectId);

    if (devices.status === 401) {
      return NextResponse.json(
        {
          error: "Google link expired. Re-link Google.",
          apiVersion: NEST_API_VERSION,
          debugUrl: "/api/nest/debug",
        },
        { status: 401 },
      );
    }
    if (devices.status === 403) {
      return NextResponse.json(
        {
          error:
            "Nest access forbidden. Confirm Device Access is enabled and re-link Google to grant thermostat scope.",
          detail: devices.data?.error?.message ?? null,
          apiVersion: NEST_API_VERSION,
          debugUrl: "/api/nest/debug",
        },
        { status: 403 },
      );
    }
    if (!devices.ok) {
      return NextResponse.json(
        {
          error: "Failed to read Nest devices",
          detail: devices.data?.error?.message ?? null,
          apiVersion: NEST_API_VERSION,
          debugUrl: "/api/nest/debug",
        },
        { status: 502 },
      );
    }

    const withClimate = pickClimateDevice(deviceList);
    if (!withClimate) {
      const types = Array.from(new Set(deviceList.map((d) => d.type ?? "?")));
      const hints = buildNestHints({
        hasSdmScope,
        structureCount: structures.data?.structures?.length ?? 0,
        deviceCount: deviceList.length,
        climateDeviceCount: 0,
        deviceTypes: types,
        oauthError: null,
        structuresError: structures.data?.error?.message ?? null,
        devicesError: null,
        devicesStatus: devices.status,
        nestProjectId: projectId,
        googleLinked: true,
      });
      const hint = hints[0] ?? "No Nest thermostat climate data found.";
      return NextResponse.json(
        {
          temperatureF: null,
          humidity: null,
          deviceName: null,
          hasData: false,
          error: hint,
          diagnostic: {
            enterpriseId: projectId,
            structureCount: structures.data?.structures?.length ?? 0,
            deviceCount: deviceList.length,
            hasSdmScope,
            deviceTypes: types.slice(0, 12),
          },
          hints,
          debugUrl: "/api/nest/debug",
          apiVersion: NEST_API_VERSION,
        },
        { status: 200 },
      );
    }

    const tempC = Number(
      withClimate.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius,
    );
    const humidity = Number(
      withClimate.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent,
    );
    const name =
      withClimate.traits?.["sdm.devices.traits.Info"]?.customName ||
      withClimate.type ||
      "Nest device";

    return NextResponse.json({
      temperatureF: Number.isFinite(tempC) ? Math.round(cToF(tempC) * 10) / 10 : null,
      humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
      deviceName: name,
      hasData: Number.isFinite(tempC) || Number.isFinite(humidity),
      apiVersion: NEST_API_VERSION,
    });
  } catch (e) {
    const message = mapGoogleOAuthError(e);
    const status = message.includes("not linked") || message.includes("invalid_grant") ? 401 : 500;
    return NextResponse.json(
      { error: message, apiVersion: NEST_API_VERSION, debugUrl: "/api/nest/debug" },
      { status },
    );
  }
}
