import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import type { GeminiMessage } from "./gemini";

const MEMORY_FILE = "chat-conversations.json";
const TTL_MS = 30 * 60_000;
const MAX_TURNS = 12;

type Store = Record<string, { updatedAt: number; turns: GeminiMessage[] }>;

async function read(): Promise<Store> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), MEMORY_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  const now = Date.now();
  for (const [key, convo] of Object.entries(store)) {
    if (now - convo.updatedAt > TTL_MS) delete store[key];
  }
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(path.join(getDataDir(), MEMORY_FILE), JSON.stringify(store, null, 2), "utf-8");
}

/** Recent turns for a conversation (a DM or a channel thread); empty once it goes stale. */
export async function getChatHistory(key: string): Promise<GeminiMessage[]> {
  const convo = (await read())[key];
  if (!convo || Date.now() - convo.updatedAt > TTL_MS) return [];
  return convo.turns;
}

export async function saveChatHistory(key: string, turns: GeminiMessage[]): Promise<void> {
  const store = await read();
  store[key] = { updatedAt: Date.now(), turns: turns.slice(-MAX_TURNS) };
  await write(store);
}

export async function clearChatHistory(key: string): Promise<void> {
  const store = await read();
  delete store[key];
  await write(store);
}
