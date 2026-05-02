import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { getNestProjectId, getOAuth2WithRefresh, requireGoogleOAuthEnv } from "@/lib/google";

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
};

function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

export async function GET(request: Request) {
  try {
    requireGoogleOAuthEnv();
  } catch {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 501 });
  }
  const projectId = getNestProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "Set GOOGLE_NEST_PROJECT_ID" }, { status: 501 });
  }

  try {
    const oauth2 = await getOAuth2WithRefresh(getGoogleRedirectUri(request));
    const accessToken = await oauth2.getAccessToken();
    const token = accessToken.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "Google token unavailable. Re-link Google." }, { status: 401 });
    }

    const res = await fetch(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(projectId)}/devices`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    const text = await res.text().catch(() => "");
    const data = text ? (JSON.parse(text) as NestDevicesResponse & { error?: { message?: string } }) : {};
    if (res.status === 401) {
      return NextResponse.json({ error: "Google link expired. Re-link Google." }, { status: 401 });
    }
    if (res.status === 403) {
      return NextResponse.json(
        {
          error:
            "Nest access forbidden. Confirm Device Access is enabled and re-link Google to grant thermostat scope.",
          detail: data?.error?.message ?? null,
        },
        { status: 403 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Failed to read Nest devices",
          detail: data?.error?.message ?? null,
        },
        { status: 502 },
      );
    }

    const devices = data.devices ?? [];
    const withClimate = devices.find((d) => {
      const c = d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
      const h = d.traits?.["sdm.devices.traits.Humidity"]?.ambientHumidityPercent;
      return Number.isFinite(c) || Number.isFinite(h);
    });
    if (!withClimate) {
      return NextResponse.json(
        {
          temperatureF: null,
          humidity: null,
          deviceName: null,
          hasData: false,
          error: "No Nest thermostat climate data found.",
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
      hasData: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "nest_error";
    const status = message.includes("not linked") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
