import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./data-dir";

const STORE_FILE = "agent-chat-sessions.json";
const MAX_SESSIONS = 40;
const MAX_TURNS = 40;

export type StoredChatAttachment = {
  name: string;
  kind: "sheet" | "text" | "image";
  summary: string;
  text: string;
  /** Image bytes are not persisted — only metadata + OCR/text summary. */
  mimeType?: string;
};

export type StoredChatTurn = {
  role: "user" | "model";
  content: string;
  actions?: { tool: string; ok: boolean; label: string }[];
  quickActions?: { id: string; label: string; prompt: string }[];
  attachments?: StoredChatAttachment[];
  pendingApproval?: {
    id: string;
    summary: string;
    items: { tool: string; label: string }[];
    expiresAt: string;
  };
  approvalResolved?: "approved" | "rejected";
};

export type ChatSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatSession = ChatSessionMeta & {
  turns: StoredChatTurn[];
};

type Store = {
  sessions: ChatSession[];
};

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), STORE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return { sessions: parsed.sessions };
  } catch {
    return { sessions: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  const sorted = [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  store.sessions = sorted.slice(0, MAX_SESSIONS);
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), STORE_FILE),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

export function titleFromTurns(turns: StoredChatTurn[]): string {
  const firstUser = turns.find((t) => t.role === "user" && t.content.trim());
  if (!firstUser) return "New chat";
  const oneLine = firstUser.content.trim().replace(/\s+/g, " ");
  return oneLine.length > 48 ? `${oneLine.slice(0, 45)}…` : oneLine;
}

/** Drop large image payloads before writing to disk. */
export function sanitizeTurnsForStorage(turns: StoredChatTurn[]): StoredChatTurn[] {
  return turns.slice(-MAX_TURNS).map((t) => ({
    ...t,
    attachments: t.attachments?.map(({ name, kind, summary, text, mimeType }) => ({
      name,
      kind,
      summary,
      text,
      ...(mimeType ? { mimeType } : {}),
    })),
  }));
}

export async function listChatSessions(): Promise<ChatSessionMeta[]> {
  const store = await readStore();
  return store.sessions
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChatSession(id: string): Promise<ChatSession | null> {
  const store = await readStore();
  return store.sessions.find((s) => s.id === id) ?? null;
}

export async function createChatSession(title = "New chat"): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: randomUUID(),
    title: title.trim() || "New chat",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  const store = await readStore();
  store.sessions.unshift(session);
  await writeStore(store);
  return session;
}

export async function saveChatSession(
  id: string,
  patch: { turns?: StoredChatTurn[]; title?: string },
): Promise<ChatSession | null> {
  const store = await readStore();
  const idx = store.sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const prev = store.sessions[idx];
  const turns = patch.turns ? sanitizeTurnsForStorage(patch.turns) : prev.turns;
  const title =
    patch.title?.trim() ||
    (patch.turns ? titleFromTurns(turns) : prev.title) ||
    "New chat";
  const next: ChatSession = {
    ...prev,
    title,
    turns,
    updatedAt: Date.now(),
  };
  store.sessions[idx] = next;
  await writeStore(store);
  return next;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.id !== id);
  if (store.sessions.length === before) return false;
  await writeStore(store);
  return true;
}
