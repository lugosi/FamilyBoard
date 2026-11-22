import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./data-dir";
import { getDefaultTimeZone } from "./google";
import { isValidCron } from "./cron";

const STORE_FILE = "agent-monitors.json";
const MAX_MONITORS = 40;
const MAX_PROMPT = 4000;
const MAX_TITLE = 80;

export type AgentMonitor = {
  id: string;
  title: string;
  enabled: boolean;
  /** 5-field crontab: minute hour day-of-month month day-of-week */
  cron: string;
  timeZone: string;
  /** Prompt for the family agent each run */
  prompt: string;
  /** Optional wiki skill path (e.g. skills/price-watch.md) */
  skillPath: string | null;
  deliverWeb: boolean;
  deliverSlack: boolean;
  /** Persistent AI chat session for web delivery (append each run) */
  sessionId: string | null;
  lastRunAt: string | null;
  lastRunSlot: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type Store = {
  monitors: AgentMonitor[];
};

function envEnabledDefault(): boolean {
  const raw = process.env.AGENT_MONITORS_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/** Global kill-switch (env). Individual monitors still have enabled flags. */
export function areAgentMonitorsEnabled(): boolean {
  return envEnabledDefault();
}

function clampTitle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "Monitor";
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
}

function clampPrompt(raw: string): string {
  return raw.trim().slice(0, MAX_PROMPT);
}

function normalizeSkillPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim().replace(/^\/+/, "");
  if (!p) return null;
  if (!/^skills\/[\w./-]+\.md$/i.test(p)) return null;
  return p;
}

function normalizeMonitor(raw: Partial<AgentMonitor> | null | undefined): AgentMonitor | null {
  if (!raw || typeof raw !== "object") return null;
  const cron = typeof raw.cron === "string" ? raw.cron.trim() : "";
  if (!isValidCron(cron)) return null;
  const prompt = typeof raw.prompt === "string" ? clampPrompt(raw.prompt) : "";
  if (!prompt) return null;
  const nowIso = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : randomUUID(),
    title: clampTitle(typeof raw.title === "string" ? raw.title : "Monitor"),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    cron,
    timeZone:
      typeof raw.timeZone === "string" && raw.timeZone.trim()
        ? raw.timeZone.trim()
        : getDefaultTimeZone(),
    prompt,
    skillPath: normalizeSkillPath(raw.skillPath),
    deliverWeb: typeof raw.deliverWeb === "boolean" ? raw.deliverWeb : true,
    deliverSlack: typeof raw.deliverSlack === "boolean" ? raw.deliverSlack : false,
    sessionId: typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId.trim() : null,
    lastRunAt: typeof raw.lastRunAt === "string" && raw.lastRunAt ? raw.lastRunAt : null,
    lastRunSlot: typeof raw.lastRunSlot === "string" && raw.lastRunSlot ? raw.lastRunSlot : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : nowIso,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : nowIso,
  };
}

async function readRaw(): Promise<Store> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), STORE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || !Array.isArray(parsed.monitors)) return { monitors: [] };
    return { monitors: parsed.monitors };
  } catch {
    return { monitors: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  const monitors = store.monitors
    .map((m) => normalizeMonitor(m))
    .filter((m): m is AgentMonitor => Boolean(m))
    .slice(0, MAX_MONITORS);
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), STORE_FILE),
    JSON.stringify({ monitors }, null, 2),
    "utf-8",
  );
}

export async function listAgentMonitors(): Promise<AgentMonitor[]> {
  const store = await readRaw();
  return store.monitors
    .map((m) => normalizeMonitor(m))
    .filter((m): m is AgentMonitor => Boolean(m))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAgentMonitor(id: string): Promise<AgentMonitor | null> {
  const list = await listAgentMonitors();
  return list.find((m) => m.id === id) ?? null;
}

export type CreateAgentMonitorInput = {
  title?: string;
  cron: string;
  prompt: string;
  skillPath?: string | null;
  timeZone?: string;
  enabled?: boolean;
  deliverWeb?: boolean;
  deliverSlack?: boolean;
};

export async function createAgentMonitor(input: CreateAgentMonitorInput): Promise<AgentMonitor> {
  const nowIso = new Date().toISOString();
  const draft = normalizeMonitor({
    id: randomUUID(),
    title: input.title,
    cron: input.cron,
    prompt: input.prompt,
    skillPath: input.skillPath ?? null,
    timeZone: input.timeZone,
    enabled: input.enabled,
    deliverWeb: input.deliverWeb,
    deliverSlack: input.deliverSlack,
    sessionId: null,
    lastRunAt: null,
    lastRunSlot: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  if (!draft) {
    throw new Error("invalid_monitor");
  }
  const store = await readRaw();
  store.monitors.unshift(draft);
  await writeStore(store);
  return draft;
}

export type PatchAgentMonitorInput = Partial<
  Pick<
    AgentMonitor,
    | "title"
    | "cron"
    | "prompt"
    | "skillPath"
    | "timeZone"
    | "enabled"
    | "deliverWeb"
    | "deliverSlack"
    | "sessionId"
    | "lastRunAt"
    | "lastRunSlot"
    | "lastError"
  >
>;

export async function patchAgentMonitor(
  id: string,
  patch: PatchAgentMonitorInput,
): Promise<AgentMonitor | null> {
  const store = await readRaw();
  const idx = store.monitors.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  const prev = normalizeMonitor(store.monitors[idx]);
  if (!prev) return null;
  const next = normalizeMonitor({
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (!next) throw new Error("invalid_monitor");
  store.monitors[idx] = next;
  await writeStore(store);
  return next;
}

export async function deleteAgentMonitor(id: string): Promise<boolean> {
  const store = await readRaw();
  const before = store.monitors.length;
  store.monitors = store.monitors.filter((m) => m.id !== id);
  if (store.monitors.length === before) return false;
  await writeStore(store);
  return true;
}

export async function markAgentMonitorRan(
  id: string,
  input: {
    slot: string;
    sessionId?: string | null;
    error?: string | null;
  },
): Promise<AgentMonitor | null> {
  return patchAgentMonitor(id, {
    lastRunAt: new Date().toISOString(),
    lastRunSlot: input.slot,
    lastError: input.error ?? null,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  });
}
