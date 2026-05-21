import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/app-url";

/** PCM returns here after the user grants home/device access. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?nest_pcm_error=${encodeURIComponent(error)}`, getAppOrigin(request)),
    );
  }

  return NextResponse.redirect(new URL("/?nest_pcm=linked", getAppOrigin(request)));
}
