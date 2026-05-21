import { NextResponse } from "next/server";
import { getNestPcmRedirectUri } from "@/lib/app-url";
import { buildNestPartnerConnectionsAuthUrl } from "@/lib/nest-sdm";
import { getNestProjectId, requireGoogleOAuthEnv } from "@/lib/google";

/** Redirect to Google Nest Partner Connections Manager (grant home + device access). */
export async function GET(request: Request) {
  let clientId: string;
  try {
    ({ clientId } = requireGoogleOAuthEnv());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google OAuth not configured" },
      { status: 500 },
    );
  }

  const projectId = getNestProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "Set GOOGLE_NEST_PROJECT_ID" }, { status: 501 });
  }

  const url = buildNestPartnerConnectionsAuthUrl(
    projectId,
    clientId,
    getNestPcmRedirectUri(request),
  );
  return NextResponse.redirect(url);
}
