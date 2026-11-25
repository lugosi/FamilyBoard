/**
 * Morning brief: gather calendar / weather / todos / house attention, then
 * DM registered Slack users and post a web AI chat session.
 */

import { getBackgroundGoogleRedirectUri } from "./app-url";
import { addDaysToDateKey, listEventsInRange, todayDateKey } from "./calendar";
import {
  createChatSession,
  saveChatSession,
} from "./agent-chat-sessions";
import {
  dateKeyInZone,
  DEFAULT_MORNING_BRIEF_PROMPT,
  formatMorningBrief,
  shouldSendDailyBrief,
  weekdayLongInZone,
  type MorningBriefParts,
} from "./daily-brief-format";
import {
  markDailyBriefSent,
  readDailyBriefStore,
  type DailyBriefStore,
} from "./daily-brief-store";
import { getDefaultTimeZone, readGoogleTokens } from "./google";
import { fetchHouseDashboard } from "./house-dashboard";
import { markdownTablesForSlack } from "./markdown-slack";
import { isSlackConfigured, postSlackMessage } from "./slack";
import { listTodos } from "./todos";
import { fetchOpenMeteo } from "./weather";

export type DailyBriefDelivery = {
  dateKey: string;
  textSlack: string;
  textBoard: string;
  slack: { userId: string; ok: boolean; error?: string }[];
  webSessionId: string | null;
  skipped?: string;
};

const g = globalThis as typeof globalThis & {
  __familyboardDailyBriefRunning?: boolean;
};

async function gatherParts(now = new Date()): Promise<MorningBriefParts> {
  const timeZone = getDefaultTimeZone();
  const dateKey = todayDateKey(timeZone, now);
  const headline = `Good morning · ${weekdayLongInZone(now, timeZone)}`;

  let weatherLine: string | undefined;
  try {
    const snap = await fetchOpenMeteo();
    if (snap) {
      const cur = snap.current;
      const today = snap.daily.find((d) => d.date === dateKey) ?? snap.daily[0];
      const bits = [`${Math.round(cur.temperatureF)}°F now`];
      if (today) {
        bits.push(`high ${Math.round(today.maxF)}° / low ${Math.round(today.minF)}°`);
      }
      weatherLine = bits.join(" · ");
    }
  } catch {
    /* optional */
  }

  let events: MorningBriefParts["events"] = [];
  try {
    if ((await readGoogleTokens())?.refresh_token) {
      const rows = await listEventsInRange(
        getBackgroundGoogleRedirectUri(),
        dateKey,
        addDaysToDateKey(dateKey, 1),
        { max: 40 },
      );
      events = rows.map((e) => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
      }));
    }
  } catch {
    /* optional */
  }

  let todos: MorningBriefParts["todos"] = [];
  try {
    const all = await listTodos();
    todos = all
      .filter((t) => !t.done)
      .slice(0, 12)
      .map((t) => ({ title: t.title, dueHint: t.dueHint }));
  } catch {
    /* optional */
  }

  let houseAttention: MorningBriefParts["houseAttention"] = [];
  try {
    const dash = await fetchHouseDashboard();
    houseAttention = dash.panels
      .filter((p) => p.attention)
      .map((p) => ({ title: p.title, status: p.status }));
  } catch {
    /* optional */
  }

  return {
    dateKey,
    timeZone,
    headline,
    weatherLine,
    events,
    todos,
    houseAttention,
  };
}

async function deliverSlack(
  userIds: string[],
  text: string,
): Promise<DailyBriefDelivery["slack"]> {
  if (!userIds.length || !isSlackConfigured()) return [];
  const out: DailyBriefDelivery["slack"] = [];
  for (const userId of userIds) {
    try {
      // chat.postMessage accepts a user id and opens/uses the DM channel.
      await postSlackMessage({
        channel: userId,
        text: markdownTablesForSlack(text, { timeZone: getDefaultTimeZone() }),
      });
      out.push({ userId, ok: true });
    } catch (e) {
      out.push({
        userId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

async function deliverWebAgent(text: string, dateKey: string): Promise<string | null> {
  const title = `Morning · ${dateKey}`;
  const session = await createChatSession(title);
  await saveChatSession(session.id, {
    title,
    turns: [
      { role: "user", content: "Morning brief for today" },
      {
        role: "model",
        content: text,
        actions: [{ tool: "daily_brief", ok: true, label: "Morning brief" }],
      },
    ],
  });
  return session.id;
}

export type DailyBriefDeliveryOpts = {
  deliverWeb?: boolean;
  deliverSlack?: boolean;
  slackUserIds?: string[];
  timeZone?: string;
  /** Optional note appended under the brief (from editable monitor prompt). */
  extraNote?: string;
  /** Skip creating the one-off web chat (caller persists into a monitor session). */
  skipWebSession?: boolean;
  markSent?: boolean;
};

function appendExtraNote(text: string, extraNote: string | undefined, channel: "slack" | "board"): string {
  const note = extraNote?.trim() ?? "";
  if (!note || note === DEFAULT_MORNING_BRIEF_PROMPT) return text;
  const bold = (s: string) => (channel === "slack" ? `*${s}*` : `**${s}**`);
  return `${text}\n\n${bold("Note")}\n${note}`.trim();
}

/** Build + deliver the morning brief (Slack DMs + web AI session). */
export async function runDailyBrief(opts?: {
  force?: boolean;
  now?: Date;
  /** When set (e.g. from Scheduled checks), overrides store delivery flags. */
  delivery?: DailyBriefDeliveryOpts;
}): Promise<DailyBriefDelivery> {
  const now = opts?.now ?? new Date();
  const store = await readDailyBriefStore();
  const delivery = opts?.delivery;
  const timeZone = delivery?.timeZone || store.timeZone || getDefaultTimeZone();
  const dateKey = dateKeyInZone(now, timeZone);
  const deliverWeb = delivery?.deliverWeb ?? store.webAgent;
  const wantSlack = delivery?.deliverSlack ?? store.slackUserIds.length > 0;
  const slackUserIds = delivery?.slackUserIds ?? store.slackUserIds;
  const skipWebSession = delivery?.skipWebSession === true;
  const markSent = delivery?.markSent !== false;

  if (!store.enabled && !opts?.force && !delivery) {
    return {
      dateKey,
      textSlack: "",
      textBoard: "",
      slack: [],
      webSessionId: null,
      skipped: "disabled",
    };
  }

  if (
    !opts?.force &&
    !delivery &&
    !shouldSendDailyBrief(now, {
      timeZone,
      hour: store.hour,
      minute: store.minute,
      lastSentDateKey: store.lastSentDateKey,
    })
  ) {
    return {
      dateKey,
      textSlack: "",
      textBoard: "",
      slack: [],
      webSessionId: null,
      skipped: "not_due",
    };
  }

  if (g.__familyboardDailyBriefRunning) {
    return {
      dateKey,
      textSlack: "",
      textBoard: "",
      slack: [],
      webSessionId: null,
      skipped: "in_flight",
    };
  }

  g.__familyboardDailyBriefRunning = true;
  try {
    const parts = await gatherParts(now);
    const textSlack = appendExtraNote(
      formatMorningBrief(parts, "slack"),
      delivery?.extraNote,
      "slack",
    );
    const textBoard = appendExtraNote(
      formatMorningBrief(parts, "board"),
      delivery?.extraNote,
      "board",
    );

    const slack =
      wantSlack && slackUserIds.length
        ? await deliverSlack(slackUserIds, textSlack)
        : [];

    let webSessionId: string | null = null;
    if (deliverWeb && !skipWebSession) {
      try {
        webSessionId = await deliverWebAgent(textBoard, parts.dateKey);
      } catch (e) {
        console.warn(
          "[daily-brief] web session failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    const slackFails = slack.filter((s) => !s.ok);
    const error =
      slackFails.length > 0
        ? `slack_failed:${slackFails.map((s) => s.userId).join(",")}`
        : deliverWeb && !skipWebSession && !webSessionId
          ? "web_session_failed"
          : null;

    if (markSent) {
      await markDailyBriefSent({ dateKey: parts.dateKey, error });
    }

    console.log(
      `[daily-brief] sent ${parts.dateKey}: slack ${slack.filter((s) => s.ok).length}/${slack.length}, web=${webSessionId ? "yes" : "no"}`,
    );

    return {
      dateKey: parts.dateKey,
      textSlack,
      textBoard,
      slack,
      webSessionId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (markSent) {
      await markDailyBriefSent({ dateKey, error: message }).catch(() => undefined);
    }
    throw e;
  } finally {
    g.__familyboardDailyBriefRunning = false;
  }
}

export async function getDailyBriefStatus(): Promise<
  DailyBriefStore & { dueSoon: boolean; dateKey: string }
> {
  const store = await readDailyBriefStore();
  const now = new Date();
  const dateKey = dateKeyInZone(now, store.timeZone);
  const dueSoon = shouldSendDailyBrief(now, {
    timeZone: store.timeZone,
    hour: store.hour,
    minute: store.minute,
    lastSentDateKey: store.lastSentDateKey,
  });
  return { ...store, dueSoon, dateKey };
}

/**
 * Legacy ticker — scheduling now lives on the Morning brief Scheduled check.
 * Kept so `/api/daily-brief` send_now and Slack opt-in still work; the poll
 * is a no-op to avoid double-sends with `tickAgentMonitors`.
 */
export async function tickDailyBrief(): Promise<void> {
  return;
}
