import { getBackgroundGoogleRedirectUri } from "./app-url";
import { isGeminiConfigured, type GeminiMessage } from "./gemini";
import { runFamilyAgent } from "./agent";
import { clearChatHistory, getChatHistory, saveChatHistory } from "./chat-memory";
import {
  getSlackConfig,
  getSlackUserName,
  openSlackSocketUrl,
  postSlackMessage,
  setSlackReaction,
  slackAuthTest,
  slackTextToPlain,
} from "./slack";

const MAX_BACKOFF_MS = 60_000;
const WORKING_REACTION = "eyes";
const RESET_WORDS = new Set(["reset", "/reset", "new", "/new"]);

export type SlackBotState = {
  running: boolean;
  connected: boolean;
  connectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  handled: number;
  team: string | null;
  botUserId: string | null;
  botName: string | null;
};

type SlackMessageEvent = {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
};

type SocketFrame = {
  type?: string;
  reason?: string;
  envelope_id?: string;
  payload?: { event_id?: string; event?: SlackMessageEvent };
};

type BotGlobal = {
  state: SlackBotState;
  socket: WebSocket | null;
  attempts: number;
  queue: Promise<void>;
  seenEvents: string[];
};

const g = globalThis as typeof globalThis & { __familyboardSlackBot?: BotGlobal };

function bot(): BotGlobal {
  g.__familyboardSlackBot ??= {
    state: {
      running: false,
      connected: false,
      connectedAt: null,
      lastEventAt: null,
      lastError: null,
      handled: 0,
      team: null,
      botUserId: null,
      botName: null,
    },
    socket: null,
    attempts: 0,
    queue: Promise.resolve(),
    seenEvents: [],
  };
  return g.__familyboardSlackBot;
}

export function getSlackBotState(): SlackBotState {
  return { ...bot().state };
}

type Incoming = {
  user: string;
  channel: string;
  ts: string;
  /** Set for channel mentions: replies (and memory) live in this thread. */
  threadTs?: string;
  text: string;
};

/** DMs to the bot, and @mentions in channels it was invited to. Everything else is ignored. */
export function toIncoming(
  event: SlackMessageEvent | undefined,
  botUserId: string | null,
): Incoming | null {
  if (!event?.user || !event.channel || !event.ts || event.bot_id) return null;
  if (event.user === botUserId) return null;
  const text = slackTextToPlain(event.text ?? "", botUserId ?? undefined);
  if (!text) return null;
  if (event.type === "message" && event.channel_type === "im" && !event.subtype) {
    return { user: event.user, channel: event.channel, ts: event.ts, text };
  }
  if (event.type === "app_mention") {
    return {
      user: event.user,
      channel: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts ?? event.ts,
      text,
    };
  }
  return null;
}

async function handle(msg: Incoming): Promise<void> {
  const state = bot().state;
  const key = msg.threadTs ? `slack:${msg.channel}:${msg.threadTs}` : `slack:dm:${msg.user}`;
  const reply = (text: string) =>
    postSlackMessage({ channel: msg.channel, text, threadTs: msg.threadTs });

  if (RESET_WORDS.has(msg.text.toLowerCase())) {
    await clearChatHistory(key);
    await reply("Fresh start. What do you need?");
    state.handled += 1;
    return;
  }
  if (!isGeminiConfigured()) {
    await reply("FamilyBoard's assistant isn't set up yet (GEMINI_API_KEY is missing).");
    return;
  }

  const name = await getSlackUserName(msg.user);
  // Threads are shared by the family, so label who said what.
  const content = msg.threadTs && name ? `${name}: ${msg.text}` : msg.text;
  const turns: GeminiMessage[] = [...(await getChatHistory(key)), { role: "user", content }];

  await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: true });
  try {
    const result = await runFamilyAgent({
      messages: turns,
      redirectUri: getBackgroundGoogleRedirectUri(),
      channel: "slack",
      senderName: name,
    });
    await saveChatHistory(key, [...turns, { role: "model", content: result.reply }]);
    const changed = result.actions.filter((a) => a.tool !== "find_events" && a.tool !== "list_todos" && a.tool !== "list_calendars");
    const footer = changed.length
      ? `\n${changed.map((a) => `${a.ok ? "✅" : "⚠️"} ${a.label}`).join("\n")}`
      : "";
    await reply(`${result.reply}${footer}`);
    state.handled += 1;
  } catch (e) {
    state.lastError = `Agent: ${e instanceof Error ? e.message : String(e)}`;
    await reply("Sorry, I hit a snag talking to the assistant. Try again in a minute.");
  } finally {
    await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: false });
  }
}

function onFrame(b: BotGlobal, ws: WebSocket, raw: string): void {
  let frame: SocketFrame;
  try {
    frame = JSON.parse(raw) as SocketFrame;
  } catch {
    return;
  }
  if (frame.envelope_id) ws.send(JSON.stringify({ envelope_id: frame.envelope_id }));

  if (frame.type === "hello") {
    b.attempts = 0;
    b.state.connected = true;
    b.state.connectedAt = new Date().toISOString();
    if (b.state.lastError?.startsWith("Socket:")) b.state.lastError = null;
    return;
  }
  if (frame.type === "disconnect") {
    ws.close();
    return;
  }
  if (frame.type !== "events_api") return;

  const eventId = frame.payload?.event_id;
  if (eventId) {
    if (b.seenEvents.includes(eventId)) return;
    b.seenEvents.push(eventId);
    if (b.seenEvents.length > 500) b.seenEvents.splice(0, 250);
  }
  const msg = toIncoming(frame.payload?.event, b.state.botUserId);
  if (!msg) return;
  b.state.lastEventAt = new Date().toISOString();
  b.queue = b.queue
    .then(() => handle(msg))
    .catch((e) => {
      b.state.lastError = e instanceof Error ? e.message : String(e);
    });
}

async function connect(): Promise<void> {
  const b = bot();
  try {
    if (!b.state.botUserId) {
      const auth = await slackAuthTest();
      b.state.team = auth.team;
      b.state.botUserId = auth.botUserId;
      b.state.botName = auth.botName;
    }
    const url = await openSlackSocketUrl();
    const ws = new WebSocket(url);
    b.socket = ws;
    ws.onmessage = (ev) => onFrame(b, ws, typeof ev.data === "string" ? ev.data : String(ev.data));
    ws.onerror = () => {
      b.state.lastError = "Socket: connection error";
    };
    ws.onclose = () => {
      const wasConnected = b.state.connected;
      b.state.connected = false;
      if (b.socket === ws) b.socket = null;
      scheduleReconnect(wasConnected ? 500 : undefined);
    };
  } catch (e) {
    b.state.lastError = `Socket: ${e instanceof Error ? e.message : String(e)}`;
    scheduleReconnect();
  }
}

function scheduleReconnect(delayMs?: number): void {
  const b = bot();
  b.attempts += 1;
  const delay = delayMs ?? Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(b.attempts, 5));
  setTimeout(() => void connect(), delay);
}

export function startSlackBot(): boolean {
  const b = bot();
  if (b.state.running || !getSlackConfig()) return b.state.running;
  b.state.running = true;
  void connect();
  console.log("[slack] Socket Mode bot starting");
  return true;
}
