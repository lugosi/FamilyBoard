import { NextResponse } from "next/server";
import { readGoogleTokens } from "@/lib/google";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { fetchGmailSnapshot } from "@/lib/gmail";

export async function GET(request: Request) {
  const tokens = await readGoogleTokens();
  if (!tokens?.refresh_token) {
    return NextResponse.json(
      { error: "Google account not linked" },
      { status: 401 },
    );
  }
  try {
    const snapshot = await fetchGmailSnapshot(getGoogleRedirectUri(request));
    return NextResponse.json(snapshot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "gmail_error";
    const status =
      message.includes("not linked") || message.includes("invalid_grant")
        ? 401
        : message.toLowerCase().includes("insufficient") ||
            message.toLowerCase().includes("scope")
          ? 403
          : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
