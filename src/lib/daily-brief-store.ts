import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { getDefaultTimeZone } from "./google";
import { parseSlackUserIdList } from "./daily-brief-format";

const STORE_FILE = "daily-brief.json";

export type DailyBriefStore = {
  enabled: boolean;
  webAgent: boolean;
  hour: number;
  minute: number;
  timeZone: string;
  lastSentDateKey: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  slackUserIds: string[];
  slackOptOut: string[];
};

function clampHour(n: number): number {
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.floor(n))) : 7;
}

function clampMinute(n: number): number {
  return Number.isFinite(n) ? Math.min(59, Math.max(0, Math.floor(n))) : 0;
}

function envEnabledDefault(): boolean {
  const raw = process.env.DAILY_BRIEF_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return true;
}

function envWebDefault(): boolean {
  const raw = process.env.DAILY_BRIEF_WEB?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export function defaultDailyBriefStore(): DailyBriefStore {
  return {
    enabled: envEnabledDefault(),
    webAgent: envWebDefault(),
    hour: clampHour(Number(process.env.DAILY_BRIEF_HOUR ?? 7)),
    minute: clampMinute(Number(process.env.DAILY_BRIEF_MINUTE ?? 0)),
    timeZone: getDefaultTimeZone(),
    lastSentDateKey: null,
    lastSentAt: null,
    lastError: null,
    slackUserIds: parseSlackUserIdList(process.env.DAILY_BRIEF_SLACK_USER_IDS),
    slackOptOut: [],
  };
}

function normalize(raw: Partial<DailyBriefStore> | null | undefined): DailyBriefStore {
  const base = defaultDailyBriefStore();
  if (!raw || typeof raw !== "object") return base;
  const slackUserIds = Array.isArray(raw.slackUserIds)
    ? [...new Set(raw.slackUserIds.map((id) => String(id).trim().toUpperCase()).filter((id) => /^U[A-Z0-9]+$/.test(id)))]
    : base.slackUserIds;
  const slackOptOut = Array.isArray(raw.slackOptOut)
    ? [...new Set(raw.slackOptOut.map((id) => String(id).trim().toUpperCase()).filter((id) => /^U[A-Z0-9]+$/.test(id)))]
    : [];
  // Env seeds always join unless opted out.
  for (const id of parseSlackUserIdList(process.env.DAILY_BRIEF_SLACK_USER_IDS)) {
    if (!slackOptOut.includes(id) && !slackUserIds.includes(id)) slackUserIds.push(id);
  }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    webAgent: typeof raw.webAgent === "boolean" ? raw.webAgent : base.webAgent,
    hour: clampHour(typeof raw.hour === "number" ? raw.hour : base.hour),
    minute: clampMinute(typeof raw.minute === "number" ? raw.minute : base.minute),
    timeZone:
      typeof raw.timeZone === "string" && raw.timeZone.trim()
        ? raw.timeZone.trim()
        : base.timeZone,
    lastSentDateKey:
      typeof raw.lastSentDateKey === "string" && raw.lastSentDateKey
        ? raw.lastSentDateKey
        : null,
    lastSentAt: typeof raw.lastSentAt === "string" && raw.lastSentAt ? raw.lastSentAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    slackUserIds: slackUserIds.filter((id) => !slackOptOut.includes(id)),
    slackOptOut,
  };
}

async function readRaw(): Promise<Partial<DailyBriefStore> | null> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), STORE_FILE), "utf-8");
    return JSON.parse(raw) as Partial<DailyBriefStore>;
  } catch {
    return null;
  }
}

export async function readDailyBriefStore(): Promise<DailyBriefStore> {
  return normalize(await readRaw());
}

export async function writeDailyBriefStore(store: DailyBriefStore): Promise<DailyBriefStore> {
  const next = normalize(store);
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), STORE_FILE),
    JSON.stringify(next, null, 2),
    "utf-8",
  );
  return next;
}

export async function patchDailyBriefStore(
  patch: Partial<
    Pick<DailyBriefStore, "enabled" | "webAgent" | "hour" | "minute" | "timeZone">
  >,
): Promise<DailyBriefStore> {
  const cur = await readDailyBriefStore();
  return writeDailyBriefStore({ ...cur, ...patch });
}

/** Register a Slack user for morning DMs (no-op if opted out). */
export async function registerSlackDailyBriefUser(userId: string): Promise<DailyBriefStore> {
  const id = userId.trim().toUpperCase();
  if (!/^U[A-Z0-9]+$/.test(id)) return readDailyBriefStore();
  const cur = await readDailyBriefStore();
  if (cur.slackOptOut.includes(id)) return cur;
  if (cur.slackUserIds.includes(id)) return cur;
  return writeDailyBriefStore({
    ...cur,
    slackUserIds: [...cur.slackUserIds, id],
  });
}

export async function setSlackDailyBriefOptIn(
  userId: string,
  optIn: boolean,
): Promise<DailyBriefStore> {
  const id = userId.trim().toUpperCase();
  if (!/^U[A-Z0-9]+$/.test(id)) return readDailyBriefStore();
  const cur = await readDailyBriefStore();
  if (optIn) {
    return writeDailyBriefStore({
      ...cur,
      slackOptOut: cur.slackOptOut.filter((x) => x !== id),
      slackUserIds: cur.slackUserIds.includes(id) ? cur.slackUserIds : [...cur.slackUserIds, id],
    });
  }
  return writeDailyBriefStore({
    ...cur,
    slackUserIds: cur.slackUserIds.filter((x) => x !== id),
    slackOptOut: cur.slackOptOut.includes(id) ? cur.slackOptOut : [...cur.slackOptOut, id],
  });
}

export async function markDailyBriefSent(input: {
  dateKey: string;
  error?: string | null;
}): Promise<DailyBriefStore> {
  const cur = await readDailyBriefStore();
  return writeDailyBriefStore({
    ...cur,
    lastSentDateKey: input.dateKey,
    lastSentAt: new Date().toISOString(),
    lastError: input.error ?? null,
  });
}
