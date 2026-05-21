import { NextResponse } from "next/server";
import { NEST_API_VERSION, runNestDiagnostics } from "@/lib/nest-sdm";

/** Full Nest / SDM diagnostic snapshot for troubleshooting. */
export async function GET(request: Request) {
  try {
    const diagnostic = await runNestDiagnostics(request);
    const ok =
      diagnostic.oauth.ok &&
      diagnostic.sdm.devices.ok &&
      diagnostic.climate.hasData;
    return NextResponse.json(diagnostic, { status: ok ? 200 : 503 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "nest_debug_error";
    return NextResponse.json(
      { error: message, apiVersion: NEST_API_VERSION },
      { status: 500 },
    );
  }
}
