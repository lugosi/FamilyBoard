/**
 * Crontab-style agent monitors: run a prompt on a schedule, deliver to a
 * persistent AI chat session and/or Slack DMs (per-monitor recipient list).
 * Built-in “Morning brief” uses the deterministic calendar/weather gatherer.
 */

import { getBackgroundGoogleRedirectUri } from "./app-url";
import { runFamilyAgent } from "./agent";
import {
  createChatSession,
  getChatSession,
  saveChatSession,
  type StoredChatTurn,
} from "./agent-chat-sessions";
import {
  areAgentMonitorsEnabled,
  ensureMorningBriefMonitor,
  listAgentMonitors,
  markAgentMonitorRan,
  MORNING_BRIEF_MONITOR_ID,
  type AgentMonitor,
} from "./agent-monitors-store";
import { cronSlotKey, describeCron, dueCronSlot } from "./cron";
import {
  listSlackDeliveryTargets,
  loadSlackDeliveryTargets,
  type SlackDeliveryTarget,
} from "./wiki-slack-people";
import { runDailyBrief } from "./daily-brief";
import { readDailyBriefStore } from "./daily-brief-store";
import { isGeminiConfigured } from "./gemini";
import { getDefaultTimeZone } from "./google";
import { markdownForSlack } from "./markdown-slack";
import { getSlackUserName, isSlackConfigured, postSlackMessage } from "./slack";

export type AgentMonitorRunResult = {
  id: string;
  title: string;
  slot: string;
  reply: string;
  webSessionId: string | null;
  slack: { userId: string; ok: boolean; error?: string }[];
  skipped?: string;
  error?: string;
};

const g = globalThis as typeof globalThis & {
  __familyboardMonitorRunning?: Set<string>;
};

function runningSet(): Set<string> {
  if (!g.__familyboardMonitorRunning) g.__familyboardMonitorRunning = new Set();
  return g.__familyboardMonitorRunning;
}

export function buildMonitorPrompt(monitor: AgentMonitor): string {
  const bits: string[] = [];
  bits.push(
    `Scheduled monitor “${monitor.title}” (cron ${monitor.cron}). Run the check below and report clearly what changed or what to do next.`,
  );
  if (monitor.skillPath) {
    const name = monitor.skillPath.replace(/^skills\//, "").replace(/\.md$/i, "");
    bits.push(`Use the “${name}” skill from the wiki when it applies.`);
  }
  bits.push("");
  bits.push(monitor.prompt.trim());
  bits.push(
    "This run is one scheduled snapshot, not a live or real-time watch. A price or other fact can change before the next check; that is expected. Do not refuse, and do not decline because the value might change later.",
  );
  bits.push(
    "If the check includes a page or product URL, call fetch_url on it and report the price or other fact printed in that result. If that text has no price, call search_web and use only figures that appear there. If neither shows a number, say the page did not include one — do not invent a price.",
  );
  bits.push(
    "Always answer in this reply with that snapshot and whether it crossed any alert in the check. Say so when nothing changed. Do not stay silent, and do not treat a wiki write as a substitute for this reply.",
  );
  return bits.join("\n");
}

function createdSlot(monitor: AgentMonitor): string | null {
  const created = Date.parse(monitor.createdAt);
  if (!Number.isFinite(created)) return null;
  return cronSlotKey(new Date(created), monitor.timeZone);
}

/** Cron slot this monitor should run for `now`, or null when it is not due. */
export function monitorDueSlot(monitor: AgentMonitor, now: Date): string | null {
  if (!monitor.enabled) return null;
  return dueCronSlot(
    monitor.cron,
    now,
    monitor.timeZone,
    monitor.lastRunSlot,
    createdSlot(monitor),
  );
}

function isDue(monitor: AgentMonitor, now: Date): boolean {
  return monitorDueSlot(monitor, now) !== null;
}

/** Explicit recipients, or everyone the picker can DM (wiki people + registered). */
export function monitorSlackRecipients(explicit: string[], fallback: string[]): string[] {
  if (explicit.length) return [...explicit];
  const out: string[] = [];
  for (const id of fallback) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Resolve who gets Slack DMs for this monitor. */
export async function resolveMonitorSlackUserIds(monitor: AgentMonitor): Promise<string[]> {
  if (!monitor.deliverSlack) return [];
  const targets = await listSlackDeliveryTargets();
  let registered: string[] = [];
  try {
    const store = await readDailyBriefStore();
    registered = store.slackUserIds;
  } catch {
    registered = [];
  }
  return monitorSlackRecipients(monitor.slackUserIds, [
    ...targets.map((t) => t.userId),
    ...registered,
  ]);
}

function monitorReplyText(reply: string): string {
  const text = reply.trim();
  if (!text || text === "Done.") return "Checked. Nothing new to report.";
  return reply.trim();
}

async function slackFailureNote(
  fails: { userId: string; error?: string }[],
): Promise<string> {
  const parts: string[] = [];
  for (const fail of fails) {
    let who = fail.userId;
    try {
      who = (await getSlackUserName(fail.userId)) || fail.userId;
    } catch {
      who = fail.userId;
    }
    const why = (fail.error || "failed").replace(/^Slack [^:]+:\s*/, "");
    parts.push(`${who}: ${why}`);
  }
  return `slack_failed:${parts.join("; ")}`;
}

async function deliverSlack(
  userIds: string[],
  text: string,
  timeZone = getDefaultTimeZone(),
): Promise<AgentMonitorRunResult["slack"]> {
  if (!isSlackConfigured() || !userIds.length) return [];
  const out: AgentMonitorRunResult["slack"] = [];
  for (const userId of userIds) {
    try {
      await postSlackMessage({
        channel: userId,
        text: markdownForSlack(text, { timeZone }),
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

async function deliverWebSession(
  monitor: AgentMonitor,
  prompt: string,
  reply: string,
  actions: { tool: string; ok: boolean; label: string }[],
): Promise<string> {
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: monitor.timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

  const userTurn: StoredChatTurn = {
    role: "user",
    content: prompt,
  };
  const modelTurn: StoredChatTurn = {
    role: "model",
    content: reply,
    actions: [
      {
        tool: monitor.kind === "morning-brief" ? "daily_brief" : "agent_monitor",
        ok: true,
        label: monitor.kind === "morning-brief" ? "Morning brief" : `Monitor · ${stamp}`,
      },
      ...actions.slice(0, 12),
    ],
  };

  if (monitor.sessionId) {
    const existing = await getChatSession(monitor.sessionId);
    if (existing) {
      await saveChatSession(existing.id, {
        title: monitor.title,
        turns: [...existing.turns, userTurn, modelTurn],
      });
      return existing.id;
    }
  }

  const session = await createChatSession(monitor.title);
  await saveChatSession(session.id, {
    title: monitor.title,
    turns: [userTurn, modelTurn],
  });
  return session.id;
}

function formatSlackDelivery(monitor: AgentMonitor, reply: string): string {
  if (monitor.kind === "morning-brief") return reply.slice(0, 3500);
  const when = describeCron(monitor.cron);
  return `*Monitor · ${monitor.title}* (${when})\n\n${reply}`.slice(0, 3500);
}

async function runMorningBriefMonitor(
  monitor: AgentMonitor,
  opts: { force?: boolean; now?: Date; slot: string },
): Promise<AgentMonitorRunResult> {
  const result = await runDailyBrief({
    force: true,
    now: opts.now,
    delivery: {
      deliverWeb: monitor.deliverWeb,
      deliverSlack: monitor.deliverSlack,
      slackUserIds: await resolveMonitorSlackUserIds(monitor),
      timeZone: monitor.timeZone,
      extraNote: monitor.prompt,
      skipWebSession: true,
      markSent: true,
    },
  });

  let webSessionId: string | null = null;
  if (monitor.deliverWeb && result.textBoard) {
    try {
      webSessionId = await deliverWebSession(
        monitor,
        "Morning brief for today",
        result.textBoard,
        [],
      );
    } catch (e) {
      console.warn(
        "[agent-monitors] morning brief web session failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const slackFails = result.slack.filter((s) => !s.ok);
  const error =
    slackFails.length > 0
      ? await slackFailureNote(slackFails)
      : monitor.deliverSlack && result.slack.length === 0
        ? isSlackConfigured()
          ? "no_slack_recipients"
          : "slack_not_configured"
        : monitor.deliverWeb && !webSessionId
          ? "web_session_failed"
          : null;

  await markAgentMonitorRan(monitor.id, {
    slot: opts.slot,
    sessionId: webSessionId ?? monitor.sessionId,
    error,
  });

  return {
    id: monitor.id,
    title: monitor.title,
    slot: opts.slot,
    reply: result.textBoard || result.textSlack,
    webSessionId,
    slack: result.slack,
    ...(error ? { error } : {}),
  };
}

/** Run one monitor now (forced) or when due. */
export async function runAgentMonitor(
  monitor: AgentMonitor,
  opts?: { force?: boolean; now?: Date },
): Promise<AgentMonitorRunResult> {
  const now = opts?.now ?? new Date();
  const dueSlot = monitorDueSlot(monitor, now);
  const slot = opts?.force ? cronSlotKey(now, monitor.timeZone) : (dueSlot ?? cronSlotKey(now, monitor.timeZone));

  if (!areAgentMonitorsEnabled() && !opts?.force) {
    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply: "",
      webSessionId: null,
      slack: [],
      skipped: "disabled_globally",
    };
  }

  if (!monitor.enabled && !opts?.force) {
    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply: "",
      webSessionId: null,
      slack: [],
      skipped: "disabled",
    };
  }

  if (!opts?.force && !dueSlot) {
    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply: "",
      webSessionId: null,
      slack: [],
      skipped: "not_due",
    };
  }

  if (monitor.kind !== "morning-brief" && !isGeminiConfigured()) {
    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply: "",
      webSessionId: null,
      slack: [],
      skipped: "gemini_not_configured",
    };
  }

  const running = runningSet();
  if (running.has(monitor.id)) {
    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply: "",
      webSessionId: null,
      slack: [],
      skipped: "in_flight",
    };
  }

  running.add(monitor.id);
  try {
    if (monitor.kind === "morning-brief") {
      return await runMorningBriefMonitor(monitor, { force: opts?.force, now, slot });
    }

    const prompt = buildMonitorPrompt(monitor);
    const result = await runFamilyAgent({
      messages: [{ role: "user", content: prompt }],
      redirectUri: getBackgroundGoogleRedirectUri(),
      channel: monitor.deliverSlack && !monitor.deliverWeb ? "slack" : "board",
    });
    const reply = monitorReplyText(result.reply);

    let webSessionId: string | null = null;
    if (monitor.deliverWeb) {
      try {
        webSessionId = await deliverWebSession(
          monitor,
          prompt,
          reply,
          result.actions ?? [],
        );
      } catch (e) {
        console.warn(
          "[agent-monitors] web session failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    let slack: AgentMonitorRunResult["slack"] = [];
    let slackNote: string | null = null;
    if (monitor.deliverSlack) {
      try {
        if (!isSlackConfigured()) {
          slackNote = "slack_not_configured";
        } else {
          const userIds = await resolveMonitorSlackUserIds(monitor);
          if (!userIds.length) {
            slackNote = "no_slack_recipients";
          } else {
            slack = await deliverSlack(
              userIds,
              formatSlackDelivery(monitor, reply),
              monitor.timeZone || getDefaultTimeZone(),
            );
          }
        }
      } catch (e) {
        console.warn(
          "[agent-monitors] slack failed:",
          e instanceof Error ? e.message : e,
        );
        slackNote = "slack_failed";
      }
    }

    const slackFails = slack.filter((s) => !s.ok);
    const error =
      slackFails.length > 0
        ? await slackFailureNote(slackFails)
        : slackNote
          ? slackNote
          : monitor.deliverWeb && !webSessionId
            ? "web_session_failed"
            : !monitor.deliverWeb && !monitor.deliverSlack
              ? "nowhere_to_deliver"
              : null;

    await markAgentMonitorRan(monitor.id, {
      slot,
      sessionId: webSessionId ?? monitor.sessionId,
      error,
    });

    console.log(
      `[agent-monitors] ran “${monitor.title}”: web=${webSessionId ? "yes" : "no"}, slack ${slack.filter((s) => s.ok).length}/${slack.length}`,
    );

    return {
      id: monitor.id,
      title: monitor.title,
      slot,
      reply,
      webSessionId,
      slack,
      ...(error ? { error } : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markAgentMonitorRan(monitor.id, { slot, error: message }).catch(() => undefined);
    throw e;
  } finally {
    running.delete(monitor.id);
  }
}

export async function getAgentMonitorsStatus(): Promise<{
  enabled: boolean;
  monitors: (AgentMonitor & { due: boolean; cronLabel: string })[];
  slackTargets: SlackDeliveryTarget[];
  slackNameError: string | null;
}> {
  await ensureMorningBriefMonitor();
  const enabled = areAgentMonitorsEnabled();
  const now = new Date();
  const monitors = await listAgentMonitors();
  const { targets: slackTargets, nameError: slackNameError } = await loadSlackDeliveryTargets();
  return {
    enabled,
    slackTargets,
    slackNameError,
    monitors: monitors.map((m) => ({
      ...m,
      due: enabled && isDue(m, now),
      cronLabel: describeCron(m.cron),
    })),
  };
}

/** Poll from background jobs (~1 min). */
export async function tickAgentMonitors(): Promise<void> {
  if (!areAgentMonitorsEnabled()) return;
  await ensureMorningBriefMonitor();
  const now = new Date();
  const monitors = await listAgentMonitors();
  for (const m of monitors) {
    if (!isDue(m, now)) continue;
    if (m.kind !== "morning-brief" && !isGeminiConfigured()) continue;
    try {
      await runAgentMonitor(m, { now });
    } catch (e) {
      console.warn(
        `[agent-monitors] tick “${m.title}” failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export { MORNING_BRIEF_MONITOR_ID };
