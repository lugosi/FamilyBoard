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
      await postSlackMessage({ channel: userId, text });
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

/** Build + deliver the morning brief (Slack DMs + web AI session). */
export async function runDailyBrief(opts?: {
  force?: boolean;
  now?: Date;
}): Promise<DailyBriefDelivery> {
  const now = opts?.now ?? new Date();
  const store = await readDailyBriefStore();
  const timeZone = store.timeZone || getDefaultTimeZone();
  const dateKey = dateKeyInZone(now, timeZone);

  if (!store.enabled && !opts?.force) {
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
    const textSlack = formatMorningBrief(parts, "slack");
    const textBoard = formatMorningBrief(parts, "board");

    const slack = store.slackUserIds.length
      ? await deliverSlack(store.slackUserIds, textSlack)
      : [];

    let webSessionId: string | null = null;
    if (store.webAgent) {
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
        : !webSessionId && store.webAgent
          ? "web_session_failed"
          : null;

    await markDailyBriefSent({ dateKey: parts.dateKey, error });

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
    await markDailyBriefSent({ dateKey, error: message }).catch(() => undefined);
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

/** Poll from background jobs (~1 min). */
export async function tickDailyBrief(): Promise<void> {
  const store = await readDailyBriefStore();
  if (!store.enabled) return;
  const now = new Date();
  if (
    !shouldSendDailyBrief(now, {
      timeZone: store.timeZone,
      hour: store.hour,
      minute: store.minute,
      lastSentDateKey: store.lastSentDateKey,
    })
  ) {
    return;
  }
  try {
    await runDailyBrief({ now });
  } catch (e) {
    console.warn("[daily-brief] tick failed:", e instanceof Error ? e.message : e);
  }
}
