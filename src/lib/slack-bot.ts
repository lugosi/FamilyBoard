import { getBackgroundGoogleRedirectUri } from "./app-url";
import { isGeminiConfigured, type GeminiMessage } from "./gemini";
import { resolvePendingApproval, runFamilyAgent } from "./agent";
import { findPendingForConversation } from "./agent-pending-writes";
import { formatPendingSummary } from "./agent-pending-writes-format";
import {
  AttachmentError,
  attachmentsToPrompt,
  fileToAttachment,
  imageAttachments,
  imagePromptNote,
  MAX_ATTACHMENTS,
  type ChatAttachment,
} from "./attachments";
import {
  extractChatChartsFromText,
  stripChatChartFences,
  type ChatChartSpec,
} from "./chat-chart";
import { clearChatHistory, getChatHistory, saveChatHistory } from "./chat-memory";
import {
  clipSlackText,
  downloadSlackFile,
  getSlackConfig,
  getSlackUserName,
  openSlackSocketUrl,
  pendingApprovalBlocks,
  postSlackMessage,
  postSlackText,
  setSlackReaction,
  slackAuthTest,
  slackTextToPlain,
  updateSlackMessage,
  uploadSlackFile,
} from "./slack";

const SLACK_ACTION_FOOTER_MAX = 12;
const SLACK_APPROVAL_BULLETS = 15;

function slackActionFooter(
  actions: { ok: boolean; label: string }[],
): string {
  if (!actions.length) return "";
  const head = actions.slice(0, SLACK_ACTION_FOOTER_MAX);
  const lines = head.map((a) => `${a.ok ? "✅" : "⚠️"} ${a.label}`);
  const rest = actions.length - head.length;
  if (rest > 0) lines.push(`…and ${rest} more`);
  return `\n${lines.join("\n")}`;
}

const MAX_BACKOFF_MS = 60_000;
const WORKING_REACTION = "eyes";
const RESET_WORDS = new Set(["reset", "/reset", "new", "/new"]);
const APPROVE_WORDS = new Set(["approve", "yes", "confirm", "ok", "lgtm"]);
const REJECT_WORDS = new Set(["cancel", "reject", "no", "nope", "deny", "denied"]);
const READ_ONLY_TOOLS = new Set([
  "find_events",
  "list_todos",
  "list_calendars",
  "search_wiki",
  "read_wiki_page",
  "read_google_sheet",
  "search_web",
  "fetch_url",
  "list_lights",
  "house_dashboard",
  "strava_athlete",
  "strava_recent_activities",
  "strava_training_summary",
]);
const LINK_STRAVA_WORDS = new Set(["link strava", "/strava", "connect strava"]);
const MORNING_ON_WORDS = new Set([
  "morning on",
  "subscribe morning",
  "morning brief on",
  "/morning on",
]);
const MORNING_OFF_WORDS = new Set([
  "morning off",
  "unsubscribe morning",
  "morning brief off",
  "/morning off",
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

type SlackAction = {
  action_id?: string;
  value?: string;
};

type SlackInteractivePayload = {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; text?: string };
  container?: { channel_id?: string; message_ts?: string };
  actions?: SlackAction[];
};

type SocketFrame = {
  type?: string;
  reason?: string;
  envelope_id?: string;
  payload?:
    | { event_id?: string; event?: SlackMessageEvent }
    | SlackInteractivePayload
    | string;
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
    postSlackText({ channel: msg.channel, text, threadTs: msg.threadTs });

  if (RESET_WORDS.has(msg.text.toLowerCase())) {
    await clearChatHistory(key);
    await reply("Fresh start. What do you need?");
    state.handled += 1;
    return;
  }

  if (LINK_STRAVA_WORDS.has(msg.text.trim().toLowerCase())) {
    const { buildStravaAuthorizeUrl, isStravaConfigured, slackAccountKey } = await import("./strava");
    if (!isStravaConfigured()) {
      await reply("Strava isn't set up on FamilyBoard yet (STRAVA_CLIENT_ID / SECRET).");
      state.handled += 1;
      return;
    }
    const name = await getSlackUserName(msg.user);
    const url = buildStravaAuthorizeUrl({
      accountKey: slackAccountKey(msg.user),
      displayName: name || undefined,
      returnPath: "/?tab=ai",
    });
    await reply(`Connect *your* Strava here (opens browser): ${url}`);
    state.handled += 1;
    return;
  }

  {
    const word = msg.text.trim().toLowerCase();
    if (MORNING_ON_WORDS.has(word) || MORNING_OFF_WORDS.has(word)) {
      const { setSlackDailyBriefOptIn } = await import("./daily-brief-store");
      const on = MORNING_ON_WORDS.has(word);
      const store = await setSlackDailyBriefOptIn(msg.user, on);
      const hh = String(store.hour).padStart(2, "0");
      const mm = String(store.minute).padStart(2, "0");
      await reply(
        on
          ? `You're on the morning brief list (${hh}:${mm} ${store.timeZone}). I'll DM you calendar + weather + todos.`
          : `Okay — no more morning brief DMs. Say *morning on* anytime to opt back in.`,
      );
      state.handled += 1;
      return;
    }
  }

  // Resolve a staged calendar/wiki review without calling the model.
  const decisionWord = msg.text.trim().toLowerCase();
  if (APPROVE_WORDS.has(decisionWord) || REJECT_WORDS.has(decisionWord)) {
    const pending = await findPendingForConversation(key);
    if (pending) {
      await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: true });
      try {
        const result = await resolvePendingApproval({
          id: pending.id,
          decision: APPROVE_WORDS.has(decisionWord) ? "approve" : "reject",
          redirectUri: getBackgroundGoogleRedirectUri(),
        });
        const footer = slackActionFooter(result.actions);
        await reply(`${result.reply}${footer}`);
        state.handled += 1;
      } catch (e) {
        await reply(e instanceof Error ? e.message : "Could not resolve that review.");
      } finally {
        await setSlackReaction({
          channel: msg.channel,
          ts: msg.ts,
          name: WORKING_REACTION,
          on: false,
        });
      }
      return;
    }
  }

  if (!isGeminiConfigured()) {
    await reply("FamilyBoard's assistant isn't set up yet (GEMINI_API_KEY is missing).");
    return;
  }

  await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: true });
  try {
    // Anyone who DMs the bot is registered for the 7am Pacific morning brief (unless opted out).
    if (!msg.threadTs) {
      const { registerSlackDailyBriefUser } = await import("./daily-brief-store");
      await registerSlackDailyBriefUser(msg.user);
    }
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

    const { isStravaConfigured, slackAccountKey } = await import("./strava");
    // Layer A.5 POC: personal/<slug>/ wiki folder for continuity past chat TTL.
    let personalContext: {
      slug: string;
      folder: string;
      depth: "dm" | "channel";
      index: string;
    } | null = null;
    try {
      const { preparePersonalContextForSlack } = await import("./personal-context");
      const { isWikilmGithubConfigured } = await import("./wikilm-github");
      if (isWikilmGithubConfigured()) {
        const prepared = await preparePersonalContextForSlack({
          slackUserId: msg.user,
          displayName: name,
          depth: msg.threadTs ? "channel" : "dm",
          ensureStrava: isStravaConfigured(),
        });
        if (prepared) {
          personalContext = {
            slug: prepared.slug,
            folder: prepared.folder,
            depth: prepared.depth,
            index: prepared.index,
          };
          if (prepared.seeded.length) {
            console.log(
              `[personal-context] seeded for ${prepared.slug}: ${prepared.seeded.join(", ")}`,
            );
          }
        }
      }
    } catch (e) {
      console.warn(
        "[personal-context] skipped:",
        e instanceof Error ? e.message : e,
      );
    }
    const result = await runFamilyAgent({
      messages: turns,
      redirectUri: getBackgroundGoogleRedirectUri(),
      channel: "slack",
      senderName: name,
      conversationKey: key,
      actor: {
        accountKey: slackAccountKey(msg.user),
        displayName: name || undefined,
      },
      personalContext,
    });
    // Don't keep image bytes in the 30‑minute chat memory.
    await saveChatHistory(key, [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: "model", content: result.reply },
    ]);
    const changed = result.actions.filter((a) => !a.ok || !READ_ONLY_TOOLS.has(a.tool));
    const footer = slackActionFooter(changed);
    const quick =
      result.quickActions?.length &&
      !result.reply.toLowerCase().includes("reply with")
        ? `\n\n*Actions — reply with one:*\n${result.quickActions.map((a) => `• ${a.label}`).join("\n")}`
        : "";
    const fileNotes = problems.length ? `\n${problems.map((p) => `⚠️ ${p}`).join("\n")}` : "";
    const raw = `${result.reply}${footer}${quick}${fileNotes}`;
    const charts: ChatChartSpec[] = [
      ...(result.charts ?? []),
      ...extractChatChartsFromText(result.reply),
    ].filter((c, i, arr) => arr.findIndex((x) => x.title === c.title) === i);
    // Same ```chart payload as the AI tab — upload PNGs, strip fences from text.
    const body = stripChatChartFences(raw, charts.length ? "remove" : "caption");
    // Thread parent for follow-ups (charts, long overflow). Top-level DMs use the
    // first bot message ts so details hang under the main reply.
    let followUpTs = msg.threadTs ?? null;
    if (result.pendingApproval) {
      // Compact bullet list for Slack — 100+ calendar proposals used to blow msg_too_long.
      const approvalSummary = formatPendingSummary(
        result.pendingApproval.items.map((i) => ({
          tool: i.tool,
          args: {},
          label: i.label,
        })),
        { maxBullets: SLACK_APPROVAL_BULLETS },
      );
      const n = result.pendingApproval.items.length;
      const shortBody = body.trim().length > 0 && body.trim().length <= 500;
      const lead = shortBody
        ? clipSlackText(body)
        : `I staged *${n}* change${n === 1 ? "" : "s"}. Full summary is in the thread — Approve applies all.`;
      // Main message carries Approve/Deny; long prose is threaded underneath.
      const main = await postSlackMessage({
        channel: msg.channel,
        text: clipSlackText(
          `⏸ ${n} change${n === 1 ? "" : "s"} staged — tap Approve / Deny (or reply *approve* / *deny*)`,
        ),
        threadTs: msg.threadTs,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: lead } },
          ...pendingApprovalBlocks(result.pendingApproval.id, approvalSummary),
        ],
      });
      followUpTs = msg.threadTs || main.ts;
      if (!shortBody && body.trim()) {
        await postSlackText({
          channel: msg.channel,
          text: body,
          threadTs: followUpTs,
        });
      }
    } else {
      const posted = await reply(body || " ");
      followUpTs = msg.threadTs || posted.ts;
    }
    if (charts.length) {
      try {
        const { renderChatChartPng } = await import("./chat-chart-png");
        for (const [i, spec] of charts.entries()) {
          const png = await renderChatChartPng(spec, { theme: "light" });
          const slug = (spec.title || `chart-${i + 1}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40);
          await uploadSlackFile({
            channel: msg.channel,
            threadTs: followUpTs ?? undefined,
            filename: `${slug || "chart"}.png`,
            title: spec.title || `Chart ${i + 1}`,
            data: png,
            mimeType: "image/png",
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        state.lastError = `Chart upload: ${message}`;
        const scopeHint = /missing_scope|not_allowed_token_type|invalid_auth/i.test(message)
          ? " Add *files:write*, reinstall the Slack app, and update `SLACK_BOT_TOKEN`."
          : "";
        const clipped = message.replace(/\s+/g, " ").slice(0, 160);
        await postSlackText({
          channel: msg.channel,
          text: `_Couldn't attach chart images: \`${clipped}\`.${scopeHint}_`,
          threadTs: followUpTs ?? undefined,
        });
      }
    }
    state.handled += 1;
  } catch (e) {
    state.lastError = `Agent: ${e instanceof Error ? e.message : String(e)}`;
    await reply("Sorry, I hit a snag talking to the assistant. Try again in a minute.");
  } finally {
    await setSlackReaction({ channel: msg.channel, ts: msg.ts, name: WORKING_REACTION, on: false });
  }
}

async function handleInteractive(payload: SlackInteractivePayload): Promise<void> {
  if (payload.type !== "block_actions") return;
  const action = payload.actions?.[0];
  if (!action?.action_id || !action.value) return;
  const approve = action.action_id === "familyboard_approve";
  const deny = action.action_id === "familyboard_deny";
  if (!approve && !deny) return;

  const channel = payload.channel?.id || payload.container?.channel_id;
  const messageTs = payload.message?.ts || payload.container?.message_ts;
  if (!channel || !messageTs) return;

  const state = bot().state;
  try {
    const result = await resolvePendingApproval({
      id: action.value,
      decision: approve ? "approve" : "reject",
      redirectUri: getBackgroundGoogleRedirectUri(),
    });
    const footer = slackActionFooter(result.actions);
    const text = `${result.reply}${footer}`;
    const statusLine = approve ? "✅ *Approved* — changes applied." : "🚫 *Denied* — nothing was written.";
    // chat.update hard-fails above ~4k (msg_too_long); keep the button message short.
    await updateSlackMessage({
      channel,
      ts: messageTs,
      text: clipSlackText(`${statusLine}\n${text}`, 3500),
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: clipSlackText(`${statusLine}\n${text}`) },
        },
      ],
    });
    // Spill the full result into the thread when it won't fit on the updated message.
    if (text.length > 2500) {
      await postSlackText({ channel, text, threadTs: messageTs });
    }
    state.handled += 1;
  } catch (e) {
    const err = e instanceof Error ? e.message : "Could not resolve that review.";
    await postSlackText({
      channel,
      text: err,
      threadTs: messageTs,
    });
  }
}

function parseInteractivePayload(
  payload: SocketFrame["payload"],
): SlackInteractivePayload | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as SlackInteractivePayload;
    } catch {
      return null;
    }
  }
  if ("actions" in payload) {
    return payload as SlackInteractivePayload;
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    (payload as { type?: string }).type === "block_actions"
  ) {
    return payload as SlackInteractivePayload;
  }
  return null;
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
  if (frame.type === "interactive") {
    const payload = parseInteractivePayload(frame.payload);
    if (!payload) return;
    b.state.lastEventAt = new Date().toISOString();
    b.queue = b.queue
      .then(() => handleInteractive(payload))
      .catch((e) => {
        b.state.lastError = e instanceof Error ? e.message : String(e);
      });
    return;
  }
  if (frame.type !== "events_api") return;

  const eventPayload = frame.payload as { event_id?: string; event?: SlackMessageEvent } | undefined;
  const eventId = eventPayload?.event_id;
  if (eventId) {
    if (b.seenEvents.includes(eventId)) return;
    b.seenEvents.push(eventId);
    if (b.seenEvents.length > 500) b.seenEvents.splice(0, 250);
  }
  const msg = toIncoming(eventPayload?.event, b.state.botUserId);
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
