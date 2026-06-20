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

export async function computeSessionToken(config: GateConfig): Promise<string> {
  const input = new TextEncoder().encode(`${config.code}:${config.secret}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
