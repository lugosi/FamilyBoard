const SESSION_COOKIE_NAME = "fb_gate";
const MAX_CODE_LENGTH = 256;

export type GateConfig = {
  code: string;
  secret: string;
};

export function getGateConfig(): GateConfig | null {
  const code = process.env.BOARD_ACCESS_CODE?.trim();
  const secret = process.env.BOARD_ACCESS_SECRET?.trim();
  if (!code || !secret) {
    return null;
  }
  return { code, secret };
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function normalizeUserCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_CODE_LENGTH) {
    return trimmed.slice(0, MAX_CODE_LENGTH);
  }
  return trimmed;
}
