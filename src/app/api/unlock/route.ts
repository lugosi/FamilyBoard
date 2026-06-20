import { NextRequest, NextResponse } from "next/server";
import {
  computeSessionToken,
  getGateConfig,
  getSessionCookieName,
  normalizeUserCode,
} from "@/lib/security-gate";

type AttemptState = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
};

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const MAX_FAILURES = 8;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const attempts = new Map<string, AttemptState>();

function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }
  return "unknown";
}

function readAttempt(key: string, now: number): AttemptState {
  const existing = attempts.get(key);
  if (!existing) {
    return { failures: 0, firstFailureAt: now, blockedUntil: 0 };
  }

  if (existing.firstFailureAt + WINDOW_MS < now && existing.blockedUntil <= now) {
    return { failures: 0, firstFailureAt: now, blockedUntil: 0 };
  }

  return existing;
}

export async function POST(request: NextRequest) {
  const config = getGateConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Access gate is not configured on the server." },
      { status: 503 },
    );
  }

  const now = Date.now();
  const clientKey = getClientKey(request);
  const attempt = readAttempt(clientKey, now);

  if (attempt.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((attempt.blockedUntil - now) / 1000);
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const payload = await request.json().catch(() => null);
  const submittedCode = normalizeUserCode(payload?.code);

  if (!submittedCode || submittedCode !== config.code) {
    const nextAttempt = { ...attempt };
    if (nextAttempt.firstFailureAt + WINDOW_MS < now) {
      nextAttempt.failures = 0;
      nextAttempt.firstFailureAt = now;
      nextAttempt.blockedUntil = 0;
    }

    nextAttempt.failures += 1;
    if (nextAttempt.failures >= MAX_FAILURES) {
      nextAttempt.blockedUntil = now + BLOCK_MS;
      nextAttempt.failures = 0;
      nextAttempt.firstFailureAt = now;
    }
    attempts.set(clientKey, nextAttempt);

    return NextResponse.json(
      { ok: false, error: "Invalid access code." },
      { status: 401 },
    );
  }

  attempts.delete(clientKey);
  const token = await computeSessionToken(config);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: getSessionCookieName(),
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
