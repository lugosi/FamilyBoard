import { NextResponse } from "next/server";
import { getGoogleRedirectUri } from "@/lib/app-url";
import { resolvePendingApproval } from "@/lib/agent";

type Body = {
  id?: string;
  decision?: "approve" | "reject";
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
  if (!id || !decision) {
    return NextResponse.json(
      { error: "id and decision (approve|reject) are required" },
      { status: 400 },
    );
  }

  try {
    const result = await resolvePendingApproval({
      id,
      decision,
      redirectUri: getGoogleRedirectUri(request),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "approve_error";
    const status = /expired|already|No pending/i.test(message) ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
