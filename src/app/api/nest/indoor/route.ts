import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getNestProjectId, requireGoogleOAuthEnv } from "@/lib/google";
import { appendClimateSample, getClimateHistory12h } from "@/lib/nest-climate-history";
import {
  NEST_API_VERSION,
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

  const history = await getClimateHistory12h();

  try {
    const token = await getNestAccessToken(getGoogleRedirectUri(request));
    const { devices, deviceList } = await fetchNestSdmState(token, projectId);

    if (devices.status === 401) {
      return NextResponse.json(
        { error: "Google link expired. Re-link Google.", history, apiVersion: NEST_API_VERSION },
        { status: 401 },
      );
    }
    if (devices.status === 403) {
      return NextResponse.json(
        {
          error: "Nest access forbidden. Re-link Google and authorize Nest devices.",
          history,
          apiVersion: NEST_API_VERSION,
        },
        { status: 403 },
      );
    }
    if (!devices.ok) {
      return NextResponse.json(
        {
          error: "Failed to read Nest devices",
          detail: devices.data?.error?.message ?? null,
          history,
          apiVersion: NEST_API_VERSION,
        },
        { status: 502 },
      );
    }

    const withClimate = pickClimateDevice(deviceList);
    if (!withClimate) {
      return NextResponse.json(
        {
          temperatureF: null,
          humidity: null,
          deviceName: null,
          hasData: false,
          error:
            "No thermostat climate data. If needed, authorize Nest devices via /api/auth/nest/pcm.",
          history,
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

    const temperatureF = Number.isFinite(tempC) ? Math.round(cToF(tempC) * 10) / 10 : null;
    const humidityRounded = Number.isFinite(humidity) ? Math.round(humidity) : null;

    await appendClimateSample({ temperatureF, humidity: humidityRounded });

    return NextResponse.json({
      temperatureF,
      humidity: humidityRounded,
      deviceName: name,
      hasData: Number.isFinite(tempC) || Number.isFinite(humidity),
      history: await getClimateHistory12h(),
      apiVersion: NEST_API_VERSION,
    });
  } catch (e) {
    const message = mapGoogleOAuthError(e);
    const status = message.includes("not linked") || message.includes("invalid_grant") ? 401 : 500;
    return NextResponse.json(
      { error: message, history, apiVersion: NEST_API_VERSION },
      { status },
    );
  }
}
