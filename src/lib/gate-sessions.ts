import { createHash, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import type { GateConfig } from "./security-gate";

const SESSIONS_FILE = "gate-sessions.json";
/** Match unlock cookie maxAge (7 days). */
export const GATE_SESSION_TTL_MS = 60 * 60 * 24 * 7 * 1000;
const MAX_SESSIONS = 32;

type StoredSession = {
  /** SHA-256 hex of the cookie token. */
  hash: string;
  createdAt: string;
  expiresAt: string;
};

type SessionStore = {
  /** SHA-256 of BOARD_ACCESS_SECRET — rotating the secret invalidates all sessions. */
  secretFingerprint: string;
  sessions: StoredSession[];
};

type MemoryCache = {
  fingerprint: string;
  /** hash → expiresAt ms */
  byHash: Map<string, number>;
  loadedAt: number;
};

let memory: MemoryCache | null = null;

function sessionsPath(): string {
  return path.join(getDataDir(), SESSIONS_FILE);
}

export function hashGateToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(`gate-secret:${secret}`, "utf8").digest("hex");
}

/** Opaque cookie value (URL-safe). */
export function mintGateToken(): string {
  return randomBytes(32).toString("base64url");
}

function emptyStore(fingerprint: string): SessionStore {
  return { secretFingerprint: fingerprint, sessions: [] };
}

async function readStore(): Promise<SessionStore | null> {
  try {
    const raw = await fs.readFile(sessionsPath(), "utf-8");
    const parsed = JSON.parse(raw) as SessionStore;
    if (!parsed || typeof parsed.secretFingerprint !== "string" || !Array.isArray(parsed.sessions)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeStore(store: SessionStore): Promise<void> {
  const file = sessionsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function prune(store: SessionStore, now: number): SessionStore {
  const sessions = store.sessions
    .filter((s) => Date.parse(s.expiresAt) > now)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_SESSIONS);
  return { ...store, sessions };
}

function toMemory(store: SessionStore): MemoryCache {
  const byHash = new Map<string, number>();
  for (const s of store.sessions) {
    byHash.set(s.hash, Date.parse(s.expiresAt));
  }
  return {
    fingerprint: store.secretFingerprint,
    byHash,
    loadedAt: Date.now(),
  };
}

async function loadForConfig(config: GateConfig): Promise<MemoryCache> {
  const fp = secretFingerprint(config.secret);
  if (memory && memory.fingerprint === fp && Date.now() - memory.loadedAt < 5_000) {
    return memory;
  }

  const now = Date.now();
  let store = (await readStore()) ?? emptyStore(fp);
  if (store.secretFingerprint !== fp) {
    store = emptyStore(fp);
    await writeStore(store);
  } else {
    const pruned = prune(store, now);
    if (pruned.sessions.length !== store.sessions.length) {
      store = pruned;
      await writeStore(store);
    }
  }

  memory = toMemory(store);
  return memory;
}

/** Create a new unlock session; returns the raw token for the cookie. */
export async function createGateSession(config: GateConfig): Promise<{
  token: string;
  maxAgeSeconds: number;
}> {
  const token = mintGateToken();
  const hash = hashGateToken(token);
  const fp = secretFingerprint(config.secret);
  const now = Date.now();
  let store = (await readStore()) ?? emptyStore(fp);
  if (store.secretFingerprint !== fp) {
    store = emptyStore(fp);
  }
  store.sessions.unshift({
    hash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GATE_SESSION_TTL_MS).toISOString(),
  });
  store = prune(store, now);
  await writeStore(store);
  memory = toMemory(store);
  return { token, maxAgeSeconds: Math.floor(GATE_SESSION_TTL_MS / 1000) };
}

/** True if the cookie token is a live session for this gate config. */
export async function isValidGateSession(
  token: string | undefined,
  config: GateConfig,
): Promise<boolean> {
  if (!token || token.length < 16 || token.length > 128) return false;
  const cache = await loadForConfig(config);
  const hash = hashGateToken(token);
  const expiresAt = cache.byHash.get(hash);
  if (expiresAt == null) {
    // Stale memory after another instance wrote — reload once.
    memory = null;
    const fresh = await loadForConfig(config);
    const again = fresh.byHash.get(hash);
    return again != null && again > Date.now();
  }
  if (expiresAt <= Date.now()) {
    cache.byHash.delete(hash);
    return false;
  }
  return true;
}

/** timing-safe compare for legacy static cookies during migration (optional). */
export function tokensEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
