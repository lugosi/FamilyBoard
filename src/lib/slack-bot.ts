import { getBackgroundGoogleRedirectUri } from "./app-url";
import { isGeminiConfigured, type GeminiMessage } from "./gemini";
import { runFamilyAgent } from "./agent";
import {
  AttachmentError,
  attachmentsToPrompt,
  fileToAttachment,
  imageAttachments,
  imagePromptNote,
  MAX_ATTACHMENTS,
  type ChatAttachment,
} from "./attachments";
import { clearChatHistory, getChatHistory, saveChatHistory } from "./chat-memory";
import {
  downloadSlackFile,
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
const READ_ONLY_TOOLS = new Set([
  "find_events",
  "list_todos",
  "list_calendars",
  "search_wiki",
  "read_wiki_page",
  "read_google_sheet",
  "search_web",
  "list_lights",
  "house_dashboard",
]);

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

type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
};

type SlackMessageEvent = {
  files?: SlackFile[];
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
  files: SlackFile[];
};

/** DMs to the bot, and @mentions in channels it was invited to. Everything else is ignored. */
export function toIncoming(
  event: SlackMessageEvent | undefined,
  botUserId: string | null,
): Incoming | null {
  if (!event?.user || !event.channel || !event.ts || event.bot_id) return null;
  if (event.user === botUserId) return null;
  const text = slackTextToPlain(event.text ?? "", botUserId ?? undefined);
  const files = (event.files ?? []).filter((f) => f.url_private_download || f.url_private);
  if (!text && !files.length) return null;
  const isDm =
    event.type === "message" &&
    event.channel_type === "im" &&
    (!event.subtype || event.subtype === "file_share");
  if (isDm) {
    return { user: event.user, channel: event.channel, ts: event.ts, text, files };
  }
  if (event.type === "app_mention") {
    return {
      user: event.user,
      channel: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts ?? event.ts,
      text,
      files,
    };
  }
  return null;
}

async function readSlackFiles(
  files: SlackFile[],
): Promise<{ attachments: ChatAttachment[]; problems: string[] }> {
  const attachments: ChatAttachment[] = [];
  const problems: string[] = [];
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    const name = file.name || file.title || "file";
    try {
      const data = await downloadSlackFile(file.url_private_download ?? file.url_private!);
      attachments.push(await fileToAttachment(name, file.mimetype ?? "", data));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      problems.push(
        message === "missing_files_read_scope"
          ? `I can't open ${name} yet: add the files:read scope to the Slack app and reinstall it.`
          : e instanceof AttachmentError
            ? message
            : `I couldn't download ${name} (${message}).`,
      );
    }
  }
  if (files.length > MAX_ATTACHMENTS) problems.push(`I only read the first ${MAX_ATTACHMENTS} files.`);
  return { attachments, problems };
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

  await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: true });
  try {
    const { attachments, problems } = await readSlackFiles(msg.files);
    if (!msg.text && !attachments.length) {
      await reply(problems.join("\n") || "I couldn't read that file.");
      return;
    }
    const name = await getSlackUserName(msg.user);
    // Threads are shared by the family, so label who said what.
    const said = msg.text || "(see attached)";
    let content = msg.threadTs && name ? `${name}: ${said}` : said;
    const filePrompt = attachmentsToPrompt(attachments);
    const note = imagePromptNote(attachments);
    const extras = [filePrompt, note].filter(Boolean).join("\n\n");
    if (extras) content += `\n\n${extras}`;
    const images = imageAttachments(attachments).map(({ mimeType, data }) => ({ mimeType, data }));
    const userTurn: GeminiMessage = {
      role: "user",
      content,
      ...(images.length ? { images } : {}),
    };
    const turns: GeminiMessage[] = [...(await getChatHistory(key)), userTurn];

    const result = await runFamilyAgent({
      messages: turns,
      redirectUri: getBackgroundGoogleRedirectUri(),
      channel: "slack",
      senderName: name,
    });
    // Don't keep image bytes in the 30‑minute chat memory.
    await saveChatHistory(key, [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: "model", content: result.reply },
    ]);
    const changed = result.actions.filter((a) => !a.ok || !READ_ONLY_TOOLS.has(a.tool));
    const footer = changed.length
      ? `\n${changed.map((a) => `${a.ok ? "✅" : "⚠️"} ${a.label}`).join("\n")}`
      : "";
    const quick =
      result.quickActions?.length &&
      !result.reply.toLowerCase().includes("reply with")
        ? `\n\n*Actions — reply with one:*\n${result.quickActions.map((a) => `• ${a.label}`).join("\n")}`
        : "";
    const fileNotes = problems.length ? `\n${problems.map((p) => `⚠️ ${p}`).join("\n")}` : "";
    await reply(`${result.reply}${footer}${quick}${fileNotes}`);
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
