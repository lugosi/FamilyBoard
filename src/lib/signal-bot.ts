import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import { getBackgroundGoogleRedirectUri } from "./app-url";
import { isGeminiConfigured, type GeminiMessage } from "./gemini";
import { runFamilyAgent } from "./agent";
import {
  findAllowedSender,
  getSignalConfig,
  receiveSignalMessages,
  sendSignalMessage,
  setSignalTyping,
  type SignalIncomingMessage,
} from "./signal";

const CONVERSATIONS_FILE = "signal-conversations.json";
const CONVERSATION_TTL_MS = 30 * 60_000;
const MAX_TURNS = 12;
const ERROR_BACKOFF_MS = 30_000;
const RESET_WORDS = new Set(["reset", "/reset", "new", "/new"]);

export type SignalBotState = {
  running: boolean;
  lastPollAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
  handled: number;
  ignored: number;
};

type Conversations = Record<string, { updatedAt: number; turns: GeminiMessage[] }>;

type BotGlobal = {
  state: SignalBotState;
  timer: ReturnType<typeof setTimeout> | null;
  polling: Promise<number> | null;
  loop: (() => Promise<void>) | null;
  inLoop: boolean;
  wakeRequested: boolean;
};

const g = globalThis as typeof globalThis & { __familyboardSignalBot?: BotGlobal };

function bot(): BotGlobal {
  g.__familyboardSignalBot ??= {
    state: {
      running: false,
      lastPollAt: null,
      lastMessageAt: null,
      lastError: null,
      handled: 0,
      ignored: 0,
    },
    timer: null,
    polling: null,
    loop: null,
    inLoop: false,
    wakeRequested: false,
  };
  return g.__familyboardSignalBot;
}

export function getSignalBotState(): SignalBotState {
  return { ...bot().state };
}

function pollIntervalMs(): number {
  const sec = Number(process.env.SIGNAL_POLL_SECONDS);
  return Number.isFinite(sec) && sec >= 2 ? sec * 1000 : 5000;
}

async function readConversations(): Promise<Conversations> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), CONVERSATIONS_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Conversations;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeConversations(data: Conversations): Promise<void> {
  const now = Date.now();
  for (const [key, convo] of Object.entries(data)) {
    if (now - convo.updatedAt > CONVERSATION_TTL_MS) delete data[key];
  }
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), CONVERSATIONS_FILE),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

async function handleMessage(msg: SignalIncomingMessage): Promise<void> {
  const state = bot().state;
  const allowed = findAllowedSender(msg);
  if (!allowed || msg.isGroup) {
    state.ignored += 1;
    return;
  }

  const conversations = await readConversations();
  const key = allowed.id;
  const existing = conversations[key];
  const fresh = existing && Date.now() - existing.updatedAt < CONVERSATION_TTL_MS;
  const history = fresh ? existing.turns : [];

  if (RESET_WORDS.has(msg.text.toLowerCase())) {
    delete conversations[key];
    await writeConversations(conversations);
    await sendSignalMessage(msg.sender, "Fresh start. What do you need?");
    state.handled += 1;
    return;
  }

  let reply: string;
  if (!isGeminiConfigured()) {
    reply = "FamilyBoard's assistant isn't set up yet (GEMINI_API_KEY is missing).";
  } else {
    await setSignalTyping(msg.sender, true);
    try {
      const turns: GeminiMessage[] = [...history, { role: "user", content: msg.text }];
      const result = await runFamilyAgent({
        messages: turns,
        redirectUri: getBackgroundGoogleRedirectUri(),
        channel: "signal",
        senderName: allowed.name ?? msg.senderName,
      });
      reply = result.reply;
      conversations[key] = {
        updatedAt: Date.now(),
        turns: [...turns, { role: "model" as const, content: reply }].slice(-MAX_TURNS),
      };
      await writeConversations(conversations);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      state.lastError = `Agent: ${message}`;
      reply = "Sorry, I hit a snag talking to the assistant. Try again in a minute.";
    } finally {
      await setSignalTyping(msg.sender, false);
    }
  }

  await sendSignalMessage(msg.sender, reply);
  state.handled += 1;
  state.lastMessageAt = new Date().toISOString();
}

/** Receive once and answer allowed senders. Concurrent callers share one in-flight poll. */
export function pollSignalOnce(): Promise<number> {
  const b = bot();
  if (b.polling) return b.polling;
  b.polling = (async () => {
    try {
      const messages = await receiveSignalMessages();
      b.state.lastPollAt = new Date().toISOString();
      if (b.state.lastError?.startsWith("Poll:")) b.state.lastError = null;
      for (const msg of messages) {
        try {
          await handleMessage(msg);
        } catch (e) {
          b.state.lastError = e instanceof Error ? e.message : String(e);
        }
      }
      return messages.length;
    } finally {
      b.polling = null;
    }
  })();
  return b.polling;
}

export function startSignalBot(): boolean {
  const b = bot();
  if (b.state.running || !getSignalConfig()) return b.state.running;
  b.state.running = true;

  b.loop = async () => {
    b.inLoop = true;
    b.wakeRequested = false;
    let delay = pollIntervalMs();
    try {
      await pollSignalOnce();
    } catch (e) {
      b.state.lastError = `Poll: ${e instanceof Error ? e.message : String(e)}`;
      delay = ERROR_BACKOFF_MS;
    }
    b.inLoop = false;
    b.timer = setTimeout(() => void b.loop?.(), b.wakeRequested ? 500 : delay);
  };
  b.timer = setTimeout(() => void b.loop?.(), 1000);
  console.log("[signal] bot polling started");
  return true;
}

/** Skip any error backoff, e.g. right after the number is registered. */
export function wakeSignalBot(): void {
  const b = bot();
  if (!b.state.running || !b.loop) return;
  if (b.state.lastError?.startsWith("Poll:")) b.state.lastError = null;
  b.wakeRequested = true;
  if (b.inLoop) return;
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => void b.loop?.(), 500);
}
