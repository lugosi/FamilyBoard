import { NextRequest, NextResponse } from "next/server";
import { isValidGateSession } from "@/lib/gate-sessions";
import { getGateConfig, getSessionCookieName } from "@/lib/security-gate";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    // OAuth provider redirects back here without the unlock cookie on some browsers.
    pathname === "/api/auth/google/callback" ||
    pathname === "/api/auth/spotify/callback" ||
    pathname === "/api/auth/strava/callback" ||
    pathname === "/api/auth/nest/pcm/callback" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

export async function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const config = getGateConfig();
  if (!config) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(getSessionCookieName())?.value;
  if (await isValidGateSession(cookie, config)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)"],
};
