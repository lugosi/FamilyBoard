import { NextRequest, NextResponse } from "next/server";
import {
  computeSessionToken,
  getGateConfig,
  getSessionCookieName,
} from "@/lib/security-gate";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
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

  const expectedToken = await computeSessionToken(config);
  const cookie = request.cookies.get(getSessionCookieName())?.value;
  if (cookie === expectedToken) {
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
