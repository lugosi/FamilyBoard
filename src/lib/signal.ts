/**
 * Signal bot transport via bbernhard/signal-cli-rest-api (run MODE=native next to FamilyBoard).
 * FamilyBoard polls GET /v1/receive, so do not set AUTO_RECEIVE_SCHEDULE on that container.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const RECEIVE_TIMEOUT_MS = 60_000;

export type SignalConfig = {
  apiUrl: string;
  number: string;
};

export type SignalAllowedSender = {
  id: string;
  name?: string;
};

export type SignalIncomingMessage = {
  /** Best identifier to reply to: number when present, else ACI uuid. */
  sender: string;
  senderNumber?: string;
  senderUuid?: string;
  senderName?: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
};

export function normalizeSignalNumber(raw: string): string {
  const trimmed = raw.trim();
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return trimmed.toLowerCase();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function getSignalConfig(): SignalConfig | null {
  const apiUrl = process.env.SIGNAL_API_URL?.trim().replace(/\/+$/, "");
  const number = normalizeSignalNumber(process.env.SIGNAL_NUMBER ?? "");
  if (!apiUrl || !number) return null;
  return { apiUrl, number };
}

export function isSignalConfigured(): boolean {
  return Boolean(getSignalConfig());
}

/** `SIGNAL_ALLOWED_SENDERS=+15551234567=Mom,+15557654321=Dad,<aci-uuid>` */
export function getSignalAllowedSenders(): SignalAllowedSender[] {
  return (process.env.SIGNAL_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split("=");
      const name = rest.join("=").trim();
      return { id: normalizeSignalNumber(id), name: name || undefined };
    })
    .filter((s) => s.id);
}

export function findAllowedSender(
  msg: Pick<SignalIncomingMessage, "senderNumber" | "senderUuid">,
): SignalAllowedSender | null {
  const ids = new Set(
    [msg.senderNumber, msg.senderUuid]
      .filter(Boolean)
      .map((v) => normalizeSignalNumber(v!)),
  );
  return getSignalAllowedSenders().find((s) => ids.has(s.id)) ?? null;
}

function requireConfig(): SignalConfig {
  const cfg = getSignalConfig();
  if (!cfg) throw new Error("signal_not_configured");
  return cfg;
}

async function signalFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const cfg = requireConfig();
  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(init?.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Signal API unreachable at ${cfg.apiUrl}: ${reason}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail =
      (json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : text.slice(0, 240)) || res.statusText;
    throw new Error(`Signal ${res.status}: ${detail}`);
  }
  return json as T;
}

const enc = (v: string) => encodeURIComponent(v);

export async function fetchSignalAbout(): Promise<{
  mode?: string;
  version?: string;
}> {
  const about = await signalFetch<{ mode?: string; version?: string }>("/v1/about");
  return { mode: about?.mode, version: about?.version };
}

export async function listSignalAccounts(): Promise<string[]> {
  const accounts = await signalFetch<string[] | null>("/v1/accounts");
  return Array.isArray(accounts) ? accounts : [];
}

/** Starts registration; Signal texts (or calls, with useVoice) a verification code. */
export async function registerSignalNumber(input: {
  captcha?: string;
  useVoice?: boolean;
}): Promise<void> {
  const { number } = requireConfig();
  const captcha = input.captcha?.trim().replace(/^signalcaptcha:\/\//, "");
  await signalFetch(`/v1/register/${enc(number)}`, {
    method: "POST",
    body: JSON.stringify({
      ...(captcha ? { captcha } : {}),
      use_voice: Boolean(input.useVoice),
    }),
  });
}

export async function verifySignalNumber(input: {
  code: string;
  pin?: string;
}): Promise<void> {
  const { number } = requireConfig();
  const code = input.code.replace(/\D/g, "");
  if (code.length < 6) throw new Error("Enter the 6-digit code from Signal");
  await signalFetch(`/v1/register/${enc(number)}/verify/${enc(code)}`, {
    method: "POST",
    body: JSON.stringify(input.pin?.trim() ? { pin: input.pin.trim() } : {}),
  });
}

export async function setSignalProfile(input: {
  name: string;
  about?: string;
}): Promise<void> {
  const { number } = requireConfig();
  await signalFetch(`/v1/profiles/${enc(number)}`, {
    method: "PUT",
    body: JSON.stringify({ name: input.name, about: input.about }),
  });
}

type ReceivedEnvelope = {
  envelope?: {
    source?: string;
    sourceNumber?: string | null;
    sourceUuid?: string | null;
    sourceName?: string | null;
    timestamp?: number;
    dataMessage?: {
      message?: string | null;
      timestamp?: number;
      groupInfo?: unknown;
      groupV2?: unknown;
    } | null;
  };
};

export async function receiveSignalMessages(): Promise<SignalIncomingMessage[]> {
  const { number } = requireConfig();
  const raw = await signalFetch<ReceivedEnvelope[] | null>(
    `/v1/receive/${enc(number)}?timeout=1&ignore_attachments=true&ignore_stories=true&send_read_receipts=true`,
    { timeoutMs: RECEIVE_TIMEOUT_MS },
  );
  const out: SignalIncomingMessage[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const env = item?.envelope;
    const text = env?.dataMessage?.message?.trim();
    if (!env || !text) continue;
    const senderNumber = env.sourceNumber || undefined;
    const senderUuid = env.sourceUuid || undefined;
    const sender = senderNumber || senderUuid || env.source;
    if (!sender) continue;
    out.push({
      sender,
      senderNumber,
      senderUuid,
      senderName: env.sourceName || undefined,
      text,
      timestamp: env.dataMessage?.timestamp ?? env.timestamp ?? Date.now(),
      isGroup: Boolean(env.dataMessage?.groupInfo || env.dataMessage?.groupV2),
    });
  }
  return out;
}

export async function sendSignalMessage(
  recipient: string,
  message: string,
): Promise<void> {
  const { number } = requireConfig();
  await signalFetch("/v2/send", {
    method: "POST",
    body: JSON.stringify({ number, recipients: [recipient], message }),
  });
}

export async function setSignalTyping(
  recipient: string,
  typing: boolean,
): Promise<void> {
  const { number } = requireConfig();
  await signalFetch(`/v1/typing-indicator/${enc(number)}`, {
    method: typing ? "PUT" : "DELETE",
    body: JSON.stringify({ recipient }),
  }).catch(() => undefined);
}
