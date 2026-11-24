"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { WikiBrowser } from "@/components/WikiBrowser";
import type {
  ApprovalResolved,
  ChatSessionMeta,
  StoredChatTurn,
} from "@/lib/agent-chat-sessions";
import {
  expireStaleApprovalsInTurns,
  isPendingApprovalExpired,
} from "@/lib/agent-pending-writes-format";
import {
  SCHEDULE_PRESETS,
  cronForSchedulePreset,
  schedulePresetForCron,
  type SchedulePresetId,
} from "@/lib/cron";
import {
  fbBtnApprove,
  fbBtnApproveLg,
  fbBtnChip,
  fbBtnDeny,
  fbBtnDenyLg,
  fbBtnSecondarySm,
} from "@/lib/ui-buttons";

const DEFAULT_MONITOR_FORM = {
  title: "",
  schedule: "daily-morning" as SchedulePresetId,
  cron: cronForSchedulePreset("daily-morning"),
  prompt: "",
  deliverWeb: true,
  deliverSlack: false,
  slackUserIds: [] as string[],
};

const PRICE_WATCH_EXAMPLE =
  "Check this product page and tell me the current price. Alert me if it drops below $40: https://example.com/product";

type Status = {
  googleLinked?: boolean;
  googleConfigured?: boolean;
  geminiConfigured?: boolean;
  wikilmGithubConfigured?: boolean;
  gmailReady?: boolean;
  inboxAutoScanMinutes?: number;
  slackConfigured?: boolean;
  stravaConfigured?: boolean;
  stravaAccounts?: { accountKey: string; displayName: string; athleteName?: string }[];
  stravaRedirectUri?: string;
  stravaCallbackDomain?: string;
  stravaTrainingSkillInWiki?: boolean;
  shoppingListsSkillInWiki?: boolean;
  dailyBrief?: {
    enabled: boolean;
    webAgent: boolean;
    hour: number;
    minute: number;
    timeZone: string;
    lastSentDateKey: string | null;
    lastSentAt: string | null;
    lastError: string | null;
    slackSubscriberCount: number;
    dueSoon: boolean;
  } | null;
  publicAppUrl?: string | null;
};

type AgentAction = { tool: string; ok: boolean; label: string };
type AgentQuickAction = { id: string; label: string; prompt: string };
type PendingApproval = {
  id: string;
  summary: string;
  items: { tool: string; label: string }[];
  expiresAt: string;
};

type ChatAttachment = {
  name: string;
  kind: "sheet" | "text" | "image";
  summary: string;
  text: string;
  truncated?: boolean;
  data?: string;
  mimeType?: string;
};

type ChatTurn = {
  role: "user" | "model";
  content: string;
  actions?: AgentAction[];
  quickActions?: AgentQuickAction[];
  attachments?: ChatAttachment[];
  pendingApproval?: PendingApproval;
  /** Once resolved, hide Approve/Deny and show the outcome. */
  approvalResolved?: ApprovalResolved;
};

function approvalOutcome(m: ChatTurn): ApprovalResolved | undefined {
  if (m.approvalResolved) return m.approvalResolved;
  if (m.pendingApproval && isPendingApprovalExpired(m.pendingApproval.expiresAt)) {
    return "expired";
  }
  return undefined;
}

function approvalOutcomeLabel(outcome: ApprovalResolved | undefined): string {
  if (outcome === "approved") return "Approved";
  if (outcome === "rejected") return "Denied";
  if (outcome === "expired") return "Expired — ask again to retry";
  return "Needs your approval to write";
}


type SkillMeta = { path: string; title: string; summary: string; category: string };

type AgentMonitorRow = {
  id: string;
  kind?: "agent" | "morning-brief";
  title: string;
  enabled: boolean;
  cron: string;
  cronLabel: string;
  prompt: string;
  skillPath: string | null;
  deliverWeb: boolean;
  deliverSlack: boolean;
  slackUserIds?: string[];
  sessionId: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  due?: boolean;
};

type SlackDeliveryTarget = {
  userId: string;
  name: string;
  source: "wiki" | "registered";
  path?: string;
};

type GmailMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  processed: boolean;
};

type SlackSnapshot = {
  configured?: boolean;
  team?: string;
  botName?: string;
  bot?: {
    running: boolean;
    connected: boolean;
    connectedAt: string | null;
    lastEventAt: string | null;
    lastError: string | null;
    handled: number;
  };
  error?: string;
};

/** Only real, safe actions — never fake family names / appointments. */
type QuickPrompt = { label: string; prompt: string; when?: (s: Status) => boolean };

const QUICK_PROMPTS: QuickPrompt[] = [
  { label: "House dashboard", prompt: "House dashboard" },
  {
    label: "This week’s calendar",
    prompt: "What's on the calendar this week?",
    when: (s) => Boolean(s.googleLinked),
  },
  {
    label: "Scan the inbox",
    prompt: "Check the inbox",
    when: (s) => Boolean(s.gmailReady),
  },
];

type AiView = "chat" | "wiki" | "tools";

const VIEW_STORAGE_KEY = "familyboard-ai-view";
const SESSION_STORAGE_KEY = "familyboard-chat-session";
const STRAVA_MEMBER_KEY = "familyboard-strava-member";
const WIKI_WRITE_TOOLS = new Set([
  "create_wiki_page",
  "edit_wiki_section",
  "rewrite_wiki_page",
  "move_wiki_page",
  "delete_wiki_page",
  "save_skill",
]);
const CALENDAR_WRITE_TOOLS = new Set(["create_event", "update_event", "delete_event"]);
const ATTACH_ACCEPT =
  ".csv,.tsv,.xlsx,.xlsm,.pdf,.txt,.md,.json,.ics,.jpg,.jpeg,.png,.gif,.webp,application/pdf,text/*,image/jpeg,image/png,image/gif,image/webp";

function ChatSessionList({
  sessions,
  sessionId,
  onSelect,
  onDelete,
  className = "",
}: {
  sessions: ChatSessionMeta[];
  sessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  return (
    <ul
      className={`board-scrollbar min-h-0 flex-1 overflow-y-auto py-1 ${className}`}
      role="listbox"
      aria-label="Chat sessions"
    >
      {sessions.length === 0 ? (
        <li className="px-3 py-2 text-sm text-slate-500">No saved chats yet</li>
      ) : (
        sessions.map((s) => (
          <li key={s.id} className="flex items-stretch gap-0.5 px-1">
            <button
              type="button"
              role="option"
              aria-selected={s.id === sessionId}
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm ${
                s.id === sessionId
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-900 hover:text-white"
              }`}
              onClick={() => onSelect(s.id)}
            >
              <span className="block truncate">{s.title}</span>
              <span className="block text-xs text-slate-500">
                {new Date(s.updatedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 text-slate-500 hover:bg-rose-950/50 hover:text-rose-200"
              aria-label={`Delete ${s.title}`}
              onClick={() => onDelete(s.id)}
            >
              ×
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

function AttachmentChip({ a, onRemove }: { a: ChatAttachment; onRemove?: () => void }) {
  return (
    <li className="flex max-w-full items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1 text-sm text-emerald-50">
      <span className="font-medium">{a.kind === "sheet" ? "Sheet" : a.kind === "image" ? "Photo" : "File"}</span>
      <span className="truncate">{a.name}</span>
      <span className="shrink-0 text-emerald-200/70">· {a.summary}</span>
      {onRemove ? (
        <button
          type="button"
          className="ml-0.5 shrink-0 text-emerald-300 hover:text-white"
          onClick={onRemove}
          aria-label={`Remove ${a.name}`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

function ApprovalButtons({
  pendingId,
  busy,
  onApprove,
  onDeny,
  size = "md",
}: {
  pendingId: string;
  busy: string | null;
  onApprove: () => void;
  onDeny: () => void;
  size?: "md" | "lg";
}) {
  const approveClass = size === "lg" ? fbBtnApproveLg : fbBtnApprove;
  const denyClass = size === "lg" ? fbBtnDenyLg : fbBtnDeny;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={approveClass}
        disabled={Boolean(busy)}
        onClick={onApprove}
        aria-label="Approve write"
      >
        {busy === `approve-${pendingId}` ? "Applying…" : "Approve"}
      </button>
      <button
        type="button"
        className={denyClass}
        disabled={Boolean(busy)}
        onClick={onDeny}
        aria-label="Deny write"
      >
        {busy === `reject-${pendingId}` ? "Denying…" : "Deny"}
      </button>
    </div>
  );
}

function ApprovalCard({
  pending,
  outcome,
  busy,
  scrollRef,
  onApprove,
  onDeny,
}: {
  pending: PendingApproval;
  outcome: ApprovalResolved | undefined;
  busy: string | null;
  scrollRef?: Ref<HTMLDivElement>;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div
      ref={scrollRef}
      className="mt-4 rounded-2xl border border-amber-600/60 bg-amber-950/40 px-4 py-3.5 text-base leading-relaxed text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.12)]"
    >
      <p className="mb-2 font-semibold text-amber-50">{approvalOutcomeLabel(outcome)}</p>
      <pre className="mb-3 whitespace-pre-wrap font-sans text-[1.05rem] leading-[1.55] text-amber-50/95">
        {pending.summary}
      </pre>
      {!outcome ? (
        <ApprovalButtons
          pendingId={pending.id}
          busy={busy}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ) : null}
    </div>
  );
}

function parseView(raw: string | null | undefined): AiView | null {
  return raw === "chat" || raw === "wiki" || raw === "tools" ? raw : null;
}

// Same rule as AppShell: query wins, else localStorage; never rewrite the URL.
function readInitialView(): AiView {
  try {
    const fromQuery = parseView(new URLSearchParams(window.location.search).get("view"));
    if (fromQuery) return fromQuery;
    return parseView(localStorage.getItem(VIEW_STORAGE_KEY)) ?? "chat";
  } catch {
    return "chat";
  }
}

const subscribeNoop = () => () => {};

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.toLowerCase().includes("application/json")) {
    return (await res.json()) as T;
  }
  const text = await res.text().catch(() => "");
  throw new Error(
    `Non-JSON response (${res.status}). ${text.slice(0, 180).replace(/\s+/g, " ")}`,
  );
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

/** Safari/WebKit often surfaces fetch failures as the opaque "Load failed". */
function friendlyChatError(e: unknown): string {
  if (!(e instanceof Error)) return "Something went wrong. Try again.";
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(e.message)) {
    return "Couldn't reach the assistant (connection dropped). Wait a moment and try again — long replies sometimes time out.";
  }
  return e.message || "Something went wrong. Try again.";
}

export function WikiLlm({
  active = true,
  variant = "page",
  onClose,
}: {
  active?: boolean;
  /** Board Ask overlay vs full AI tab. */
  variant?: "page" | "overlay";
  onClose?: () => void;
}) {
  const isOverlay = variant === "overlay";
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [slack, setSlack] = useState<SlackSnapshot | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [stravaMember, setStravaMember] = useState(() => {
    try {
      return localStorage.getItem(STRAVA_MEMBER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skillForm, setSkillForm] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const approvalCardRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<AgentMonitorRow[]>([]);
  const [monitorsEnabled, setMonitorsEnabled] = useState(true);
  const [slackTargets, setSlackTargets] = useState<SlackDeliveryTarget[]>([]);
  const [monitorForm, setMonitorForm] = useState(DEFAULT_MONITOR_FORM);
  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null);
  const [wikiFocus, setWikiFocus] = useState<{ path: string; nonce: number } | null>(null);
  const storedView = useSyncExternalStore(subscribeNoop, readInitialView, () => "chat" as AiView);
  const [pickedView, setPickedView] = useState<AiView | null>(null);
  const view = isOverlay ? "chat" : (pickedView ?? storedView);

  let unresolvedApproval: { index: number; pending: PendingApproval } | null = null;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (
      m.role === "model" &&
      m.pendingApproval &&
      !approvalOutcome(m)
    ) {
      unresolvedApproval = { index: i, pending: m.pendingApproval };
      break;
    }
  }

  const unresolvedPendingId = unresolvedApproval?.pending.id ?? null;
  useEffect(() => {
    if (!unresolvedPendingId) return;
    approvalCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [unresolvedPendingId]);
  const [wikiRefreshKey, setWikiRefreshKey] = useState(0);

  const selectView = useCallback((next: AiView) => {
    setPickedView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  const loadedOnceRef = useRef(false);
  const sessionsLoadedRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  /** Latest chat transcript (sendPrompt reads this; setState alone can be stale). */
  const chatRef = useRef<ChatTurn[]>([]);
  /**
   * Mid-turn steer: abort+retry folds follow-ups into the in-flight user turn.
   * turnBase = transcript before that user bubble; turnText/Files = combined prompt.
   */
  const turnBaseRef = useRef<ChatTurn[] | null>(null);
  const turnTextRef = useRef("");
  const turnFilesRef = useRef<ChatAttachment[]>([]);
  /** Bumped on each in-flight request so superseded (aborted-for-steer) replies are ignored. */
  const chatRequestGenRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  const rememberSessionId = useCallback((id: string | null) => {
    setSessionId(id);
    sessionIdRef.current = id;
    try {
      if (id) localStorage.setItem(SESSION_STORAGE_KEY, id);
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSessionList = useCallback(async (signalArg?: AbortSignal) => {
    const res = await fetch("/api/agent/sessions", { signal: signalArg });
    if (!res.ok) return [] as ChatSessionMeta[];
    const json = (await res.json()) as { sessions?: ChatSessionMeta[] };
    const list = json.sessions ?? [];
    setSessions(list);
    return list;
  }, []);

  const loadSession = useCallback(
    async (id: string, signalArg?: AbortSignal) => {
      const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
        signal: signalArg,
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { session?: { turns?: StoredChatTurn[] } };
      const loaded = (json.session?.turns ?? []) as ChatTurn[];
      const { turns: cleaned, changed } = expireStaleApprovalsInTurns(loaded);
      setChat(cleaned);
      rememberSessionId(id);
      setChatStatus(null);
      setSkillForm(null);
      setPending([]);
      setInput("");
      if (changed) {
        // Server getChatSession also sweeps; persist if the client still sees stale turns.
        void (async () => {
          try {
            await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ turns: cleaned }),
              signal: signalArg,
            });
          } catch {
            /* best-effort */
          }
        })();
      }
      return true;
    },
    [rememberSessionId],
  );

  const persistSession = useCallback(
    async (turns: ChatTurn[]) => {
      const stored = turns as StoredChatTurn[];
      let id = sessionIdRef.current;
      try {
        if (!id) {
          const first = stored.find((t) => t.role === "user" && t.content.trim());
          const title = first?.content.trim().replace(/\s+/g, " ").slice(0, 80) || "New chat";
          const res = await fetch("/api/agent/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          });
          if (!res.ok) return;
          const json = (await res.json()) as { session?: ChatSessionMeta };
          if (!json.session?.id) return;
          id = json.session.id;
          rememberSessionId(id);
          setSessions((prev) => [json.session!, ...prev.filter((s) => s.id !== id)]);
        }
        const res = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turns: stored }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { session?: ChatSessionMeta };
        if (json.session) {
          setSessions((prev) => {
            const rest = prev.filter((s) => s.id !== json.session!.id);
            return [json.session!, ...rest];
          });
        }
      } catch {
        /* persistence is best-effort */
      }
    },
    [rememberSessionId],
  );

  // Clear the sticky approval banner when TTL elapses without Approve/Deny.
  useEffect(() => {
    const open = chat
      .map((m, index) => ({ m, index }))
      .filter(
        ({ m }) =>
          m.role === "model" &&
          m.pendingApproval &&
          !m.approvalResolved,
      );
    if (!open.length) return;

    const now = Date.now();
    const alreadyExpired = open.some(({ m }) =>
      isPendingApprovalExpired(m.pendingApproval!.expiresAt, now),
    );
    const applyExpiry = () => {
      setChat((prev) => {
        const { turns, changed } = expireStaleApprovalsInTurns(prev);
        if (!changed) return prev;
        queueMicrotask(() => void persistSession(turns));
        return turns;
      });
    };

    const nextExpiry = alreadyExpired
      ? now
      : Math.min(...open.map(({ m }) => Date.parse(m.pendingApproval!.expiresAt)));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(applyExpiry, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [chat, persistSession]);

  const startNewSession = useCallback(async () => {
    setChat([]);
    setChatStatus(null);
    setSkillForm(null);
    setPending([]);
    setInput("");
    setSessionsOpen(false);
    try {
      const res = await fetch("/api/agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      if (res.ok) {
        const json = (await res.json()) as { session?: ChatSessionMeta };
        if (json.session?.id) {
          rememberSessionId(json.session.id);
          setSessions((prev) => [json.session!, ...prev.filter((s) => s.id !== json.session!.id)]);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    rememberSessionId(null);
  }, [rememberSessionId]);

  const refreshMonitors = useCallback(async (signalArg?: AbortSignal) => {
    try {
      const res = await fetch("/api/agent/monitors", { signal: signalArg });
      if (!res.ok) return;
      const json = (await res.json()) as {
        enabled?: boolean;
        monitors?: AgentMonitorRow[];
        slackTargets?: SlackDeliveryTarget[];
      };
      if (signalArg?.aborted) return;
      setMonitorsEnabled(json.enabled !== false);
      setMonitors(json.monitors ?? []);
      setSlackTargets(json.slackTargets ?? []);
    } catch {
      /* optional */
    }
  }, []);

  const refresh = useCallback(async (signalArg?: AbortSignal) => {
    setError(null);
    try {
      const statusRes = await fetch("/api/auth/status", { signal: signalArg });
      const statusJson = (await statusRes.json()) as Status;
      if (signalArg?.aborted) return;
      setStatus(statusJson);

      if (statusJson.gmailReady) {
        const gmailRes = await fetch("/api/gmail", { signal: signalArg });
        if (gmailRes.ok) {
          const g = (await gmailRes.json()) as { messages: GmailMessage[] };
          setMessages(g.messages ?? []);
        } else if (gmailRes.status === 403) {
          setError("Gmail needs re-link: disconnect Google and Link Google again for inbox access.");
        }
      } else {
        setMessages([]);
      }

      if (statusJson.wikilmGithubConfigured) {
        const wikiRes = await fetch("/api/wiki/pages", { signal: signalArg });
        if (wikiRes.ok) {
          const w = (await wikiRes.json()) as { pages: SkillMeta[] };
          setSkills((w.pages ?? []).filter((p) => p.category === "skills"));
        }
      } else {
        setSkills([]);
      }

      if (statusJson.slackConfigured) {
        const slackRes = await fetch("/api/slack", { signal: signalArg });
        setSlack(await parseJsonSafe<SlackSnapshot>(slackRes));
      } else {
        setSlack(null);
      }

      await refreshMonitors(signalArg);
    } catch (e) {
      if (signalArg?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load AI tab");
    }
  }, [refreshMonitors]);

  useEffect(() => {
    if (!active) return;
    if (loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [active, refresh]);

  useEffect(() => {
    if (!active || sessionsLoadedRef.current) return;
    sessionsLoadedRef.current = true;
    const ac = new AbortController();
    void (async () => {
      try {
        const list = await refreshSessionList(ac.signal);
        if (ac.signal.aborted) return;
        let preferred: string | null = null;
        try {
          preferred = localStorage.getItem(SESSION_STORAGE_KEY);
        } catch {
          preferred = null;
        }
        const pick =
          (preferred && list.find((s) => s.id === preferred)?.id) || list[0]?.id || null;
        if (pick) {
          await loadSession(pick, ac.signal);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => ac.abort();
  }, [active, loadSession, refreshSessionList]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chat, busy]);

  // Keep the prompt ready for the next turn in a conversation (Enter → reply → type again).
  const focusPrompt = useCallback(() => {
    if (!active || view !== "chat" || skillForm !== null) return;
    // rAF: wait until the input is re-enabled / remounted after busy clears.
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [active, view, skillForm]);

  useEffect(() => {
    if (busy === "chat") return;
    focusPrompt();
  }, [busy, focusPrompt]);

  useEffect(() => {
    if (active && view === "chat") focusPrompt();
  }, [active, view, focusPrompt]);

  async function attachFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || busy) return;
    if (pending.length + list.length > 3) {
      setError("Attach up to 3 files per message.");
      return;
    }
    setBusy("attach");
    setError(null);
    try {
      const form = new FormData();
      for (const f of list) form.append("file", f);
      const res = await fetch("/api/agent/attachments", { method: "POST", body: form });
      const json = await parseJsonSafe<{ attachments?: ChatAttachment[]; errors?: string[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setPending((prev) => [...prev, ...(json.attachments ?? [])]);
      if (json.errors?.length) setError(json.errors.join(" "));
      promptRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload_error");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function stopChat() {
    chatAbortRef.current?.abort();
  }

  /**
   * POST /api/agent/chat for `nextChat`. Concurrent steers bump `chatRequestGenRef`
   * and abort the previous fetch so only the latest combined prompt gets a reply.
   */
  async function runChatRequest(nextChat: ChatTurn[], opts?: { steered?: boolean }) {
    const myGen = ++chatRequestGenRef.current;
    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    setBusy("chat");
    setError(null);
    setChatStatus(
      opts?.steered
        ? "Folding that into the reply…"
        : null,
    );
    const statusTimer = window.setTimeout(() => {
      if (myGen !== chatRequestGenRef.current) return;
      setChatStatus("Still working (Gemini may be retrying) — hit Stop anytime.");
    }, 4000);
    try {
      const member = stravaMember.trim();
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextChat.map(({ role, content, attachments }) => ({
            role,
            content,
            attachments,
          })),
          ...(member
            ? {
                actorMember: member,
                actorName: member,
              }
            : {}),
        }),
        signal: ac.signal,
      });
      const json = await parseJsonSafe<{
        reply?: string;
        actions?: AgentAction[];
        quickActions?: AgentQuickAction[];
        pendingApproval?: PendingApproval;
        error?: string;
      }>(res);
      if (myGen !== chatRequestGenRef.current) return;
      if (!res.ok) throw new Error(json.error || `Assistant failed (${res.status})`);
      const withReply: ChatTurn[] = [
        ...nextChat,
        {
          role: "model",
          content: json.reply || "",
          actions: json.actions ?? [],
          ...(json.quickActions?.length ? { quickActions: json.quickActions } : {}),
          ...(json.pendingApproval ? { pendingApproval: json.pendingApproval } : {}),
        },
      ];
      chatRef.current = withReply;
      setChat(withReply);
      void persistSession(withReply);
      // Writes to calendar/wiki are staged until Approve — don't refresh as if applied.
      if (
        json.actions?.some(
          (a) =>
            a.ok &&
            !a.label.startsWith("Proposed:") &&
            !a.tool.includes("wiki") &&
            a.tool !== "find_events",
        )
      ) {
        void refresh();
      }
    } catch (e) {
      if (myGen !== chatRequestGenRef.current) return;
      if (ac.signal.aborted) {
        setChatStatus("Stopped.");
      } else {
        setError(friendlyChatError(e));
      }
      const base = turnBaseRef.current ?? chatRef.current;
      chatRef.current = base;
      setChat(base);
      setInput(turnTextRef.current);
      if (turnFilesRef.current.length) setPending(turnFilesRef.current);
    } finally {
      window.clearTimeout(statusTimer);
      if (myGen !== chatRequestGenRef.current) return;
      chatAbortRef.current = null;
      turnBaseRef.current = null;
      turnTextRef.current = "";
      turnFilesRef.current = [];
      setBusy(null);
      setChatStatus((prev) => (prev === "Stopped." ? prev : null));
      focusPrompt();
    }
  }

  async function sendPrompt(raw?: string) {
    const text = (raw ?? input).trim();
    const files = raw === undefined ? pending : [];
    if (!text && !files.length) return;
    // Block non-chat busy (approve / scan / …). While thinking, allow steers.
    if (busy && busy !== "chat") return;

    if (busy === "chat") {
      // Mid-turn steer: merge into the in-flight user bubble, abort, retry once.
      if (!turnBaseRef.current) return;
      if (files.length && turnFilesRef.current.length + files.length > 3) {
        setError("Attach up to 3 files per message.");
        return;
      }
      const combinedText = [turnTextRef.current, text].filter(Boolean).join("\n\n");
      const combinedFiles = [...turnFilesRef.current, ...files];
      turnTextRef.current = combinedText;
      turnFilesRef.current = combinedFiles;
      const nextChat: ChatTurn[] = [
        ...turnBaseRef.current,
        {
          role: "user",
          content: combinedText,
          ...(combinedFiles.length ? { attachments: combinedFiles } : {}),
        },
      ];
      chatRef.current = nextChat;
      setChat(nextChat);
      setInput("");
      if (files.length) setPending([]);
      setSkillForm(null);
      focusPrompt();
      await runChatRequest(nextChat, { steered: true });
      return;
    }

    setSkillForm(null);
    const base = chatRef.current;
    turnBaseRef.current = base;
    turnTextRef.current = text;
    turnFilesRef.current = files;
    const nextChat: ChatTurn[] = [
      ...base,
      { role: "user", content: text, ...(files.length ? { attachments: files } : {}) },
    ];
    chatRef.current = nextChat;
    setChat(nextChat);
    setInput("");
    if (files.length) setPending([]);
    focusPrompt();
    await runChatRequest(nextChat);
  }

  async function resolveApproval(
    turnIndex: number,
    decision: "approve" | "reject",
    pending: PendingApproval,
  ) {
    if (busy) return;
    setBusy(`${decision}-${pending.id}`);
    setError(null);
    const resolution: ApprovalResolved = decision === "approve" ? "approved" : "rejected";
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pending.id, decision }),
      });
      const json = await parseJsonSafe<{
        reply?: string;
        actions?: AgentAction[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || `Could not ${decision} (${res.status})`);
      // Build next transcript from chatRef — do not rely on setState updater side
      // effects after await (React may defer the updater; then persist never ran and
      // reload resurrected the sticky Approve/Deny banner).
      const prev = chatRef.current;
      let idx = prev.findIndex(
        (t) => t.role === "model" && t.pendingApproval?.id === pending.id && !t.approvalResolved,
      );
      if (idx < 0) {
        const at = prev[turnIndex];
        if (at?.role === "model" && at.pendingApproval?.id === pending.id) idx = turnIndex;
      }
      if (idx < 0) idx = turnIndex;
      const turn = prev[idx];
      if (!turn || turn.role !== "model") return;
      const next: ChatTurn[] = [...prev];
      next[idx] = {
        ...turn,
        approvalResolved: resolution,
        actions: [...(turn.actions ?? []), ...(json.actions ?? [])],
      };
      next.push({
        role: "model",
        content:
          json.reply ||
          (decision === "approve" ? "Applied." : "Denied — nothing was written."),
        actions: json.actions ?? [],
      });
      chatRef.current = next;
      setChat(next);
      await persistSession(next);
      if (
        decision === "approve" &&
        json.actions?.some((a) => a.ok && WIKI_WRITE_TOOLS.has(a.tool))
      ) {
        setWikiRefreshKey((k) => k + 1);
      }
      if (
        decision === "approve" &&
        json.actions?.some((a) => a.ok && CALENDAR_WRITE_TOOLS.has(a.tool))
      ) {
        void refresh();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "approve_error";
      if (/expired/i.test(message)) {
        const prev = chatRef.current;
        let idx = prev.findIndex(
          (t) => t.role === "model" && t.pendingApproval?.id === pending.id && !t.approvalResolved,
        );
        if (idx < 0) idx = turnIndex;
        const turn = prev[idx];
        if (turn?.pendingApproval && !turn.approvalResolved) {
          const next = [...prev];
          next[idx] = { ...turn, approvalResolved: "expired" };
          chatRef.current = next;
          setChat(next);
          await persistSession(next);
        }
      }
      setError(message);
    } finally {
      setBusy(null);
      focusPrompt();
    }
  }

  async function scanInbox() {
    if (busy) return;
    setBusy("scan");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/gmail/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      const json = await parseJsonSafe<{
        added?: { title: string }[];
        events?: { summary: string; ok: boolean; error?: string }[];
        scanned?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || `Scan failed (${res.status})`);
      const todosAdded = json.added?.length ?? 0;
      const eventsAdded = json.events?.filter((e) => e.ok).length ?? 0;
      const failed = json.events?.filter((e) => !e.ok) ?? [];
      setNote(
        `Scanned ${json.scanned ?? 0} email(s): ${todosAdded} todo(s) → wiki Todos, ${eventsAdded} calendar event(s).` +
          (failed.length
            ? ` Could not add: ${failed.map((f) => f.summary).join(", ")}.`
            : ""),
      );
      if (todosAdded > 0) setWikiRefreshKey((k) => k + 1);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan_error");
    } finally {
      setBusy(null);
    }
  }

  const sideBtn = fbBtnSecondarySm;
  const chipBtn = fbBtnChip;
  const unprocessed = messages.filter((m) => !m.processed).length;

  const activeSessionTitle =
    sessions.find((s) => s.id === sessionId)?.title ||
    (chat.length ? "Current chat" : "New chat");

  async function deleteSession(id: string) {
    await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    const list = await refreshSessionList();
    if (sessionIdRef.current === id) {
      if (list[0]) await loadSession(list[0].id);
      else await startNewSession();
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 text-lg leading-relaxed text-slate-50">
      {/* Slim toolbar — no second “Assistant” title on the full AI tab. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 px-3 py-2 sm:px-5">
        {isOverlay ? (
          <p className="truncate text-base font-semibold tracking-wide text-white sm:text-lg">
            Assistant
          </p>
        ) : (
          <div
            role="tablist"
            aria-label="Assistant view"
            className="flex gap-1 rounded-md bg-slate-900 p-0.5"
          >
            {(["chat", "wiki", "tools"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`rounded-md px-3.5 py-1.5 text-base font-medium ${
                  view === v ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => selectView(v)}
              >
                {v === "chat" ? "Chat" : v === "wiki" ? "Wiki" : "Tools"}
                {v === "tools" && unprocessed > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[1.15rem] justify-center rounded-md bg-sky-600 px-1 text-xs text-white">
                    {unprocessed}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <div className="relative ml-auto flex min-w-0 items-center gap-1.5">
          {view === "chat" ? (
            <>
              {/* Compact session menu — always on overlay; mobile fallback on AI tab. */}
              <button
                type="button"
                className={`max-w-[10rem] truncate rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-900 sm:max-w-[14rem] ${
                  isOverlay ? "" : "md:hidden"
                }`}
                onClick={() => setSessionsOpen((o) => !o)}
                aria-expanded={sessionsOpen}
                aria-haspopup="listbox"
                title={activeSessionTitle}
              >
                {activeSessionTitle}
              </button>
              {sessionsOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 flex w-[min(100vw-2rem,18rem)] flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-950 shadow-xl">
                  <button
                    type="button"
                    className="block w-full border-b border-slate-800 px-3 py-2 text-left text-sm font-medium text-sky-200 hover:bg-slate-900"
                    onClick={() => void startNewSession()}
                  >
                    + New chat
                  </button>
                  <ChatSessionList
                    className="max-h-56"
                    sessions={sessions}
                    sessionId={sessionId}
                    onSelect={(id) => {
                      setSessionsOpen(false);
                      selectView("chat");
                      void loadSession(id);
                    }}
                    onDelete={(id) => void deleteSession(id)}
                  />
                  {!isOverlay ? (
                    <button
                      type="button"
                      className="block w-full border-t border-slate-800 px-3 py-2 text-left text-sm font-medium text-slate-200 hover:bg-slate-900"
                      onClick={() => {
                        setSessionsOpen(false);
                        selectView("tools");
                      }}
                    >
                      Tools
                      {unprocessed > 0 ? ` · ${unprocessed}` : ""}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-200 disabled:opacity-50"
                disabled={busy === "chat"}
                onClick={() => void startNewSession()}
              >
                New
              </button>
            </>
          ) : null}
          {view === "chat" &&
          chat.some((m) => m.role === "model") &&
          busy !== "chat" &&
          skillForm === null &&
          status?.wikilmGithubConfigured ? (
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-emerald-200"
              onClick={() => setSkillForm("")}
            >
              Save skill
            </button>
          ) : null}
          {!isOverlay ? (
            <button
              type="button"
              className={`relative rounded-md px-3 py-1.5 text-sm font-medium md:hidden ${
                view === "tools"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
              onClick={() => selectView(view === "tools" ? "chat" : "tools")}
              aria-pressed={view === "tools"}
              aria-controls="ai-tools-panel"
            >
              Tools
              {unprocessed > 0 ? (
                <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-md bg-sky-600 px-1.5 text-xs text-white">
                  {unprocessed}
                </span>
              ) : null}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-200 disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
            aria-label="Refresh"
          >
            Refresh
          </button>
          {onClose ? (
            <button
              type="button"
              className="rounded-md px-2.5 py-1.5 text-lg leading-none text-slate-400 hover:bg-slate-900 hover:text-white"
              onClick={onClose}
              aria-label="Close assistant"
            >
              ×
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="shrink-0 border-b border-amber-900/50 bg-amber-950/50 px-4 py-2.5 text-base text-amber-50">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="shrink-0 border-b border-slate-800 bg-slate-900/80 px-4 py-2.5 text-base text-slate-100">
          {note}
        </p>
      ) : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {!isOverlay && (view === "chat" || view === "tools") ? (
          <aside
            className="board-scrollbar hidden w-56 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/80 md:flex lg:w-64"
            aria-label="Chat sessions"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2.5">
              <p className="text-sm font-semibold tracking-wide text-slate-200">Sessions</p>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm font-medium text-sky-200 hover:bg-slate-900 hover:text-sky-100 disabled:opacity-50"
                disabled={busy === "chat"}
                onClick={() => {
                  selectView("chat");
                  void startNewSession();
                }}
              >
                + New
              </button>
            </div>
            <ChatSessionList
              sessions={sessions}
              sessionId={view === "chat" ? sessionId : null}
              onSelect={(id) => {
                selectView("chat");
                void loadSession(id);
              }}
              onDelete={(id) => void deleteSession(id)}
            />
            <div className="mt-auto border-t border-slate-800/80 p-2">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm font-medium ${
                  view === "tools"
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-900 hover:text-white"
                }`}
                onClick={() => selectView("tools")}
                aria-current={view === "tools" ? "page" : undefined}
              >
                <span>Tools</span>
                {unprocessed > 0 ? (
                  <span className="inline-flex min-w-[1.25rem] justify-center rounded-md bg-sky-600 px-1.5 text-xs text-white">
                    {unprocessed}
                  </span>
                ) : null}
              </button>
            </div>
          </aside>
        ) : null}
        <section
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={
            view === "wiki" ? "Family wiki" : view === "tools" ? "Tools" : "Chat"
          }
          onDragOver={(e) => {
            if (view !== "chat" || !status?.geminiConfigured || !e.dataTransfer.types.includes("Files"))
              return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            if (view !== "chat" || !e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            void attachFiles(e.dataTransfer.files);
          }}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-600/70 bg-slate-950/90 text-lg text-emerald-100">
              Drop a file to attach
            </div>
          ) : null}

          {view === "wiki" ? (
            <div className="board-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
              <WikiBrowser
                active={active && view === "wiki"}
                configured={Boolean(status?.wikilmGithubConfigured)}
                refreshKey={wikiRefreshKey}
                focusPath={wikiFocus?.path}
                focusNonce={wikiFocus?.nonce}
                onAddToChat={(attachment) => {
                  setPending((prev) => {
                    if (prev.some((a) => a.name === attachment.name && a.text === attachment.text)) {
                      return prev;
                    }
                    if (prev.length >= 3) {
                      setError("Attach up to 3 files per message.");
                      return prev;
                    }
                    setError(null);
                    return [...prev, attachment];
                  });
                  selectView("chat");
                  // Defer focus until chat composer is mounted.
                  window.setTimeout(() => focusPrompt(), 0);
                }}
              />
            </div>
          ) : view === "tools" && !isOverlay ? (
            <div
              id="ai-tools-panel"
              className="board-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5"
              aria-label="Tools"
            >
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold tracking-tight text-white">Tools</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Scheduled checks, inbox, Strava, and Slack — full width, not a side drawer.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                    onClick={() => selectView("chat")}
                  >
                    Back to chat
                  </button>
                </div>
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">

                  {status?.stravaConfigured ? (
                    <section className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
                      <h3 className="text-base font-semibold text-white">Strava</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-400">
                        Each person links their own account. Pick who you are on this display, then connect.
                      </p>
                      {status.stravaCallbackDomain ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-500">
                          If Link opens Strava with <span className="text-rose-300">Bad Request</span>, set
                          Strava → My API Application →{" "}
                          <span className="text-slate-300">Authorization Callback Domain</span> to{" "}
                          <code className="rounded bg-slate-950 px-1 text-sky-200">
                            {status.stravaCallbackDomain}
                          </code>{" "}
                          (host only — no https://, no path). Full redirect used:{" "}
                          <code className="break-all rounded bg-slate-950 px-1 text-slate-400">
                            {status.stravaRedirectUri}
                          </code>
                          {!status.publicAppUrl ? (
                            <>
                              {" "}
                              Tip: set <code className="text-slate-300">PUBLIC_APP_URL</code> to your board’s
                              public URL so the redirect host stays stable.
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <label className="mt-3 block text-sm text-slate-300">
                        Who am I?
                        <input
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-slate-400"
                          placeholder="e.g. maya"
                          value={stravaMember}
                          onChange={(e) => {
                            const v = e.target.value;
                            setStravaMember(v);
                            try {
                              if (v.trim()) localStorage.setItem(STRAVA_MEMBER_KEY, v.trim());
                              else localStorage.removeItem(STRAVA_MEMBER_KEY);
                            } catch {
                              /* ignore */
                            }
                          }}
                          list="strava-member-suggestions"
                        />
                      </label>
                      <datalist id="strava-member-suggestions">
                        {(status.stravaAccounts ?? [])
                          .filter((a) => a.accountKey.startsWith("board:"))
                          .map((a) => (
                            <option key={a.accountKey} value={a.accountKey.slice(6)} />
                          ))}
                      </datalist>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          className={`${sideBtn} inline-flex no-underline`}
                          href={
                            stravaMember.trim()
                              ? `/api/auth/strava?member=${encodeURIComponent(stravaMember.trim())}&name=${encodeURIComponent(stravaMember.trim())}&return=${encodeURIComponent("/?tab=ai")}`
                              : undefined
                          }
                          aria-disabled={!stravaMember.trim()}
                          onClick={(e) => {
                            if (!stravaMember.trim()) e.preventDefault();
                          }}
                        >
                          Link Strava
                        </a>
                        {stravaMember.trim() &&
                        (status.stravaAccounts ?? []).some(
                          (a) => a.accountKey === `board:${stravaMember.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
                        ) ? (
                          <button
                            type="button"
                            className={sideBtn}
                            onClick={() => {
                              const id = stravaMember
                                .trim()
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, "-")
                                .replace(/^-+|-+$/g, "");
                              void (async () => {
                                await fetch("/api/auth/strava/logout", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ account: `board:${id}` }),
                                });
                                void refresh();
                              })();
                            }}
                          >
                            Unlink
                          </button>
                        ) : null}
                      </div>
                      {status.wikilmGithubConfigured ? (
                        <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-400">
                          {status.stravaTrainingSkillInWiki ? (
                            <p>
                              Training skill is in the wiki as{" "}
                              <button
                                type="button"
                                className="text-sky-300 underline-offset-2 hover:underline"
                                onClick={() => {
                                  setWikiFocus({ path: "skills/strava-training.md", nonce: Date.now() });
                                  setPickedView("wiki");
                                  selectView("chat");
                                }}
                              >
                                skills/strava-training.md
                              </button>
                              .
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="flex-1">
                                Add the 30-day training analysis skill to the wiki (one click — no copy/paste).
                              </p>
                              <button
                                type="button"
                                className={sideBtn}
                                disabled={busy === "strava-skill"}
                                onClick={() => {
                                  void (async () => {
                                    setBusy("strava-skill");
                                    setError(null);
                                    try {
                                      const res = await fetch("/api/wiki/control", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "ensure_strava_training_skill" }),
                                      });
                                      const json = (await res.json()) as {
                                        status?: string;
                                        path?: string;
                                        error?: string;
                                      };
                                      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
                                      setNote(
                                        json.status === "created"
                                          ? `Added ${json.path ?? "skills/strava-training.md"} to the wiki`
                                          : `Wiki already has ${json.path ?? "skills/strava-training.md"}`,
                                      );
                                      setWikiRefreshKey((k) => k + 1);
                                      void refresh();
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Could not add skill");
                                    } finally {
                                      setBusy(null);
                                    }
                                  })();
                                }}
                              >
                                {busy === "strava-skill" ? "Adding…" : "Add skill to wiki"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-500">
                          Link the family wiki to auto-install the training skill under{" "}
                          <code className="text-slate-400">skills/</code>.
                        </p>
                      )}
                      {(status.stravaAccounts ?? []).length > 0 ? (
                        <ul className="mt-3 space-y-1 text-sm text-slate-400">
                          {(status.stravaAccounts ?? []).map((a) => (
                            <li key={a.accountKey}>
                              {a.displayName}
                              {a.athleteName ? ` · ${a.athleteName}` : ""}{" "}
                              <span className="text-slate-600">({a.accountKey})</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-white">
                        Inbox
                        {unprocessed ? (
                          <span className="ml-2 text-sm font-normal text-slate-400">{unprocessed} new</span>
                        ) : null}
                      </h3>
                      <button
                        type="button"
                        className={sideBtn}
                        disabled={Boolean(busy) || !status?.gmailReady || !status?.geminiConfigured}
                        onClick={() => void scanInbox()}
                      >
                        {busy === "scan" ? "Scanning…" : "Scan"}
                      </button>
                    </div>
                    {!status?.googleConfigured ? (
                      <p className="text-base leading-relaxed text-slate-400">
                        Configure Google OAuth, then Link Google.
                      </p>
                    ) : !status?.gmailReady ? (
                      <p className="text-base leading-relaxed text-slate-400">
                        <a className="text-sky-300 underline" href="/api/auth/google">
                          Link Google
                        </a>{" "}
                        for the inbox drop-box.
                      </p>
                    ) : (
                      <ul className="space-y-2 text-base">
                        {messages.length === 0 ? (
                          <li className="text-slate-500">No mail yet.</li>
                        ) : (
                          messages.slice(0, 8).map((m) => (
                            <li key={m.id} className="rounded-lg bg-slate-900/80 px-3 py-2.5">
                              <div className="truncate font-medium text-slate-50">{m.subject}</div>
                              <div className="truncate text-slate-400">{m.from}</div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </section>

                  <section className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-3 text-base leading-relaxed text-slate-300">
                    <h3 className="mb-1.5 font-semibold text-white">Todos</h3>
                    {status?.wikilmGithubConfigured ? (
                      <p>
                        Live in the wiki as{" "}
                        <button
                          type="button"
                          className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                          onClick={() => {
                            selectView("chat");
                            setWikiFocus((prev) => ({
                              path: "todos/list.md",
                              nonce: (prev?.nonce ?? 0) + 1,
                            }));
                            selectView("wiki");
                          }}
                        >
                          Todos
                        </button>{" "}
                        (<code className="text-slate-200">todos/list.md</code>). Ask the assistant or open that
                        page to check them off. Shopping / Black Friday adds without a link get an Amazon offer;
                        ask about local stock near Santa Monica too.
                      </p>
                    ) : (
                      <p>
                        Ask the assistant to list or add todos. Link the GitHub wiki to keep them on{" "}
                        <code className="text-slate-200">todos/list.md</code>.
                      </p>
                    )}
                    {status?.wikilmGithubConfigured ? (
                      <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-400">
                        {status.shoppingListsSkillInWiki ? (
                          <p>
                            Shopping skill is in the wiki as{" "}
                            <button
                              type="button"
                              className="text-sky-300 underline-offset-2 hover:underline"
                              onClick={() => {
                                setWikiFocus({ path: "skills/shopping-lists.md", nonce: Date.now() });
                                selectView("wiki");
                                selectView("chat");
                              }}
                            >
                              skills/shopping-lists.md
                            </button>
                            .
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="flex-1">
                              Add the shopping / Black Friday + Santa Monica local-retail skill to the wiki.
                            </p>
                            <button
                              type="button"
                              className={sideBtn}
                              disabled={busy === "shopping-skill"}
                              onClick={() => {
                                void (async () => {
                                  setBusy("shopping-skill");
                                  setError(null);
                                  try {
                                    const res = await fetch("/api/wiki/control", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ action: "ensure_shopping_lists_skill" }),
                                    });
                                    const json = (await res.json()) as {
                                      status?: string;
                                      path?: string;
                                      error?: string;
                                    };
                                    if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
                                    setNote(
                                      json.status === "created"
                                        ? `Added ${json.path ?? "skills/shopping-lists.md"} to the wiki`
                                        : `Wiki already has ${json.path ?? "skills/shopping-lists.md"}`,
                                    );
                                    setWikiRefreshKey((k) => k + 1);
                                    void refresh();
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : "Could not add skill");
                                  } finally {
                                    setBusy(null);
                                  }
                                })();
                              }}
                            >
                              {busy === "shopping-skill" ? "Adding…" : "Add skill to wiki"}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        Link the family wiki to auto-install the shopping skill under{" "}
                        <code className="text-slate-400">skills/</code>.
                      </p>
                    )}
                  </section>

                  <section
                    aria-label="Scheduled checks"
                    className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-3 text-base leading-relaxed text-slate-300 lg:col-span-2"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-white">Scheduled checks</h3>
                      <button
                        type="button"
                        className={sideBtn}
                        disabled={Boolean(busy) || !monitorForm.prompt.trim()}
                        onClick={() => {
                          void (async () => {
                            setBusy("monitor-save");
                            setError(null);
                            try {
                              const cron =
                                monitorForm.schedule === "custom"
                                  ? monitorForm.cron.trim()
                                  : cronForSchedulePreset(monitorForm.schedule);
                              const payload = {
                                title:
                                  monitorForm.title.trim() ||
                                  monitorForm.prompt.trim().slice(0, 48) ||
                                  "Price check",
                                cron,
                                prompt: monitorForm.prompt.trim(),
                                deliverWeb: monitorForm.deliverWeb,
                                deliverSlack: monitorForm.deliverSlack,
                                slackUserIds: monitorForm.deliverSlack
                                  ? monitorForm.slackUserIds
                                  : [],
                              };
                              const res = editingMonitorId
                                ? await fetch(
                                    `/api/agent/monitors/${encodeURIComponent(editingMonitorId)}`,
                                    {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify(payload),
                                    },
                                  )
                                : await fetch("/api/agent/monitors", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(payload),
                                  });
                              const json = (await res.json()) as { error?: string };
                              if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
                              const wasEdit = Boolean(editingMonitorId);
                              setMonitorForm(DEFAULT_MONITOR_FORM);
                              setEditingMonitorId(null);
                              setNote(wasEdit ? "Check updated" : "Check saved — it’ll run on that schedule");
                              await refreshMonitors();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Could not save check");
                            } finally {
                              setBusy(null);
                            }
                          })();
                        }}
                      >
                        {busy === "monitor-save"
                          ? "Saving…"
                          : editingMonitorId
                            ? "Save"
                            : "Start watching"}
                      </button>
                    </div>
                    <p className="mb-3 text-sm text-slate-400">
                      Morning brief is listed here like any other check — edit its time, notes, and who
                      gets a Slack DM. Add more checks (price watch, etc.) the same way
                      {monitorsEnabled ? "." : " · currently off (AGENT_MONITORS_ENABLED=0)."}
                    </p>
                    <div className="mb-3 grid gap-3">
                      <label className="grid gap-1 text-sm">
                        <span className="text-slate-500">Name</span>
                        <input
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
                          value={monitorForm.title}
                          placeholder="AirPods price"
                          onChange={(e) =>
                            setMonitorForm((f) => ({ ...f, title: e.target.value }))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="text-slate-500">
                          {editingMonitorId &&
                          monitors.find((m) => m.id === editingMonitorId)?.kind === "morning-brief"
                            ? "What’s included / extra note"
                            : "What should it check?"}
                        </span>
                        <textarea
                          className="min-h-[5rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
                          value={monitorForm.prompt}
                          placeholder={PRICE_WATCH_EXAMPLE}
                          onChange={(e) =>
                            setMonitorForm((f) => ({ ...f, prompt: e.target.value }))
                          }
                        />
                      </label>
                      {!monitorForm.prompt.trim() && !editingMonitorId ? (
                        <button
                          type="button"
                          className="justify-self-start text-sm text-sky-300 underline underline-offset-2 hover:text-sky-200"
                          onClick={() =>
                            setMonitorForm((f) => ({
                              ...f,
                              title: f.title || "Price watch",
                              prompt: PRICE_WATCH_EXAMPLE,
                            }))
                          }
                        >
                          Use a price-tracking example
                        </button>
                      ) : null}
                      <fieldset className="grid gap-1.5">
                        <legend className="text-sm text-slate-500">How often?</legend>
                        <div className="flex flex-wrap gap-1.5">
                          {SCHEDULE_PRESETS.map((p) => {
                            const active = monitorForm.schedule === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                title={p.hint}
                                className={`rounded-md border px-2.5 py-1.5 text-sm ${
                                  active
                                    ? "border-sky-500/70 bg-sky-950/50 text-sky-50"
                                    : "border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-500"
                                }`}
                                onClick={() =>
                                  setMonitorForm((f) => ({
                                    ...f,
                                    schedule: p.id,
                                    cron: p.cron,
                                  }))
                                }
                              >
                                {p.label}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            className={`rounded-md border px-2.5 py-1.5 text-sm ${
                              monitorForm.schedule === "custom"
                                ? "border-sky-500/70 bg-sky-950/50 text-sky-50"
                                : "border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-500"
                            }`}
                            onClick={() =>
                              setMonitorForm((f) => ({ ...f, schedule: "custom" }))
                            }
                          >
                            Custom…
                          </button>
                        </div>
                        {monitorForm.schedule !== "custom" ? (
                          <p className="text-xs text-slate-500">
                            {SCHEDULE_PRESETS.find((p) => p.id === monitorForm.schedule)?.hint}
                          </p>
                        ) : (
                          <label className="grid gap-1 text-sm">
                            <span className="text-slate-500">Custom schedule</span>
                            <input
                              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-100"
                              value={monitorForm.cron}
                              placeholder="0 9 * * *"
                              onChange={(e) =>
                                setMonitorForm((f) => ({
                                  ...f,
                                  schedule: "custom",
                                  cron: e.target.value,
                                }))
                              }
                            />
                          </label>
                        )}
                      </fieldset>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <label className="inline-flex items-center gap-1.5 text-slate-200">
                          <input
                            type="checkbox"
                            checked={monitorForm.deliverWeb}
                            onChange={(e) =>
                              setMonitorForm((f) => ({ ...f, deliverWeb: e.target.checked }))
                            }
                          />
                          Keep a chat history
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-slate-200">
                          <input
                            type="checkbox"
                            checked={monitorForm.deliverSlack}
                            onChange={(e) =>
                              setMonitorForm((f) => ({ ...f, deliverSlack: e.target.checked }))
                            }
                            disabled={!status?.slackConfigured}
                          />
                          Slack DMs
                        </label>
                        {editingMonitorId ? (
                          <button
                            type="button"
                            className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                            onClick={() => {
                              setEditingMonitorId(null);
                              setMonitorForm(DEFAULT_MONITOR_FORM);
                            }}
                          >
                            Cancel edit
                          </button>
                        ) : input.trim() ? (
                          <button
                            type="button"
                            className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                            onClick={() =>
                              setMonitorForm((f) => ({
                                ...f,
                                prompt: input.trim(),
                                title: f.title || input.trim().slice(0, 40),
                              }))
                            }
                          >
                            Use current chat prompt
                          </button>
                        ) : null}
                      </div>
                      {monitorForm.deliverSlack && status?.slackConfigured ? (
                        <fieldset className="grid gap-1.5 rounded-md border border-slate-800 bg-slate-950/50 px-2.5 py-2">
                          <legend className="px-1 text-sm text-slate-500">Who gets the DM?</legend>
                          {slackTargets.length === 0 ? (
                            <p className="text-xs text-slate-500">
                              Add <code className="text-slate-400">slack: U…</code> to a wiki people page,
                              or have someone DM the bot (they’ll show up as registered).
                              {monitorForm.slackUserIds.length === 0
                                ? " Empty selection → all registered morning-brief subscribers."
                                : ""}
                            </p>
                          ) : (
                            <>
                              <p className="text-xs text-slate-500">
                                Leave everyone unchecked to DM all registered subscribers. Wiki people
                                need <code className="text-slate-400">slack: U…</code> in frontmatter.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {slackTargets.map((t) => {
                                  const checked = monitorForm.slackUserIds.includes(t.userId);
                                  return (
                                    <label
                                      key={t.userId}
                                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
                                        checked
                                          ? "border-sky-500/70 bg-sky-950/40 text-sky-50"
                                          : "border-slate-700 text-slate-200"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          setMonitorForm((f) => ({
                                            ...f,
                                            slackUserIds: checked
                                              ? f.slackUserIds.filter((id) => id !== t.userId)
                                              : [...f.slackUserIds, t.userId],
                                          }))
                                        }
                                      />
                                      <span>{t.name}</span>
                                      <span className="text-xs text-slate-500">
                                        {t.source === "wiki" ? "wiki" : "Slack"}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </fieldset>
                      ) : null}
                    </div>
                    {monitors.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Nothing scheduled yet — Morning brief should appear after refresh.
                      </p>
                    ) : (
                      <ul className="grid gap-2">
                        {monitors.map((m) => {
                          const isBrief = m.kind === "morning-brief";
                          const slackCount = m.slackUserIds?.length ?? 0;
                          return (
                          <li
                            key={m.id}
                            className="rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-50">
                                  {m.title}
                                  {isBrief ? (
                                    <span className="ml-1.5 text-xs font-normal text-sky-300/90">
                                      built-in
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-slate-400">
                                  {m.cronLabel || m.cron}
                                  {m.enabled ? "" : " · paused"}
                                  {m.deliverWeb ? " · chat" : ""}
                                  {m.deliverSlack
                                    ? slackCount
                                      ? ` · Slack (${slackCount})`
                                      : " · Slack (all registered)"
                                    : ""}
                                </div>
                                <div className="truncate text-slate-500" title={m.prompt}>
                                  {m.prompt}
                                </div>
                                <div className="text-slate-500">
                                  Last check:{" "}
                                  {m.lastRunAt
                                    ? new Date(m.lastRunAt).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })
                                    : "not yet"}
                                  {m.lastError ? (
                                    <span className="text-amber-200"> · {m.lastError}</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <button
                                  type="button"
                                  className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                                  disabled={Boolean(busy)}
                                  onClick={() => {
                                    void (async () => {
                                      setBusy(`monitor-toggle-${m.id}`);
                                      try {
                                        await fetch(`/api/agent/monitors/${encodeURIComponent(m.id)}`, {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ enabled: !m.enabled }),
                                        });
                                        await refreshMonitors();
                                        void refresh();
                                      } finally {
                                        setBusy(null);
                                      }
                                    })();
                                  }}
                                >
                                  {m.enabled ? "Pause" : "Resume"}
                                </button>
                                <button
                                  type="button"
                                  className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                                  disabled={Boolean(busy)}
                                  onClick={() => {
                                    void (async () => {
                                      setBusy(`monitor-run-${m.id}`);
                                      setError(null);
                                      try {
                                        const res = await fetch(
                                          `/api/agent/monitors/${encodeURIComponent(m.id)}`,
                                          {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ action: "run_now" }),
                                          },
                                        );
                                        const json = (await res.json()) as {
                                          error?: string;
                                          webSessionId?: string | null;
                                          skipped?: string;
                                        };
                                        if (!res.ok) {
                                          throw new Error(json.error || `Failed (${res.status})`);
                                        }
                                        setNote(
                                          json.webSessionId
                                            ? `${isBrief ? "Morning brief" : "Check"} ran · opened chat`
                                            : json.skipped
                                              ? `Skipped (${json.skipped})`
                                              : `${isBrief ? "Morning brief" : "Check"} ran`,
                                        );
                                        await refreshMonitors();
                                        await refreshSessionList();
                                        if (json.webSessionId) {
                                          selectView("chat");
                                          await loadSession(json.webSessionId);
                                        }
                                      } catch (e) {
                                        setError(
                                          e instanceof Error ? e.message : "Could not run check",
                                        );
                                      } finally {
                                        setBusy(null);
                                      }
                                    })();
                                  }}
                                >
                                  {busy === `monitor-run-${m.id}`
                                    ? isBrief
                                      ? "Sending…"
                                      : "Checking…"
                                    : isBrief
                                      ? "Send now"
                                      : "Check now"}
                                </button>
                                {m.sessionId ? (
                                  <button
                                    type="button"
                                    className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                                    disabled={Boolean(busy)}
                                    onClick={() => {
                                      void (async () => {
                                        selectView("chat");
                                        await loadSession(m.sessionId!);
                                      })();
                                    }}
                                  >
                                    Open chat
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                                  disabled={Boolean(busy)}
                                  onClick={() => {
                                    setEditingMonitorId(m.id);
                                    setMonitorForm({
                                      title: m.title,
                                      schedule: schedulePresetForCron(m.cron),
                                      cron: m.cron,
                                      prompt: m.prompt,
                                      deliverWeb: m.deliverWeb,
                                      deliverSlack: m.deliverSlack,
                                      slackUserIds: m.slackUserIds ?? [],
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                                {!isBrief ? (
                                  <button
                                    type="button"
                                    className="text-amber-200 underline underline-offset-2 hover:text-amber-100"
                                    disabled={Boolean(busy)}
                                    onClick={() => {
                                      void (async () => {
                                        setBusy(`monitor-del-${m.id}`);
                                        try {
                                          await fetch(
                                            `/api/agent/monitors/${encodeURIComponent(m.id)}`,
                                            { method: "DELETE" },
                                          );
                                          if (editingMonitorId === m.id) {
                                            setEditingMonitorId(null);
                                            setMonitorForm(DEFAULT_MONITOR_FORM);
                                          }
                                          await refreshMonitors();
                                        } finally {
                                          setBusy(null);
                                        }
                                      })();
                                    }}
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section aria-label="Slack">
                    <h3 className="mb-2 text-base font-semibold text-white">Slack</h3>
                    {!status?.slackConfigured ? (
                      <p className="text-base text-slate-400">
                        Set <code className="text-slate-200">SLACK_BOT_TOKEN</code> +{" "}
                        <code className="text-slate-200">SLACK_APP_TOKEN</code>.
                      </p>
                    ) : !slack ? (
                      <p className="text-base text-slate-500">Loading…</p>
                    ) : (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-base">
                        <dt className="text-slate-500">Workspace</dt>
                        <dd className="text-slate-100">{slack.team || "—"}</dd>
                        <dt className="text-slate-500">Bot</dt>
                        <dd className="text-slate-100">{slack.botName ? `@${slack.botName}` : "—"}</dd>
                        <dt className="text-slate-500">Connected</dt>
                        <dd className={slack.bot?.connected ? "text-slate-100" : "text-amber-200"}>
                          {slack.bot?.connected
                            ? `yes · ${timeAgo(slack.bot.connectedAt)}`
                            : slack.bot?.running
                              ? "reconnecting…"
                              : "no"}
                        </dd>
                      </dl>
                    )}
                  </section>
                </div>
              </div>
            </div>
          ) : !status?.geminiConfigured ? (
            <p className="m-auto max-w-lg px-6 text-center text-lg text-slate-300">
              Set <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-100">GEMINI_API_KEY</code> to
              chat. Link Google for calendar and inbox.
            </p>
          ) : (
            <>
              <div className="board-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5">
                {chat.length === 0 ? (
                  <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6">
                    <p className="text-3xl font-medium tracking-tight text-white">What do you need?</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_PROMPTS.filter((q) => !q.when || (status ? q.when(status) : false)).map(
                        (q) => (
                          <button
                            key={q.label}
                            type="button"
                            className={chipBtn}
                            onClick={() => void sendPrompt(q.prompt)}
                          >
                            {q.label}
                          </button>
                        ),
                      )}
                      {skills.map((sk) => (
                        <button
                          key={sk.path}
                          type="button"
                          title={sk.summary}
                          className="rounded-md border border-emerald-800/50 bg-emerald-950/25 px-3.5 py-2 text-base text-emerald-100 hover:border-emerald-600"
                          onClick={() => {
                            setInput(`Use the “${sk.title}” skill`);
                            promptRef.current?.focus();
                          }}
                        >
                          {sk.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.map((m, i) => (
                    <div
                      key={`${m.role}-${i}`}
                      className={`mx-auto flex w-full max-w-3xl ${m.role === "user" ? "justify-end" : ""}`}
                    >
                      <div
                        className={`max-w-[min(100%,42rem)] px-1 py-0.5 ${
                          m.role === "user"
                            ? "rounded-2xl bg-slate-800 px-4 py-3.5 text-lg leading-relaxed text-white whitespace-pre-wrap"
                            : "text-[1.125rem] leading-[1.65] text-slate-50"
                        }`}
                      >
                        {m.actions?.length ? (
                          <ul className="mb-2 flex flex-wrap gap-1.5">
                            {m.actions.map((a, j) => (
                              <li
                                key={j}
                                className={`rounded-md border px-2 py-0.5 text-sm ${
                                  a.ok
                                    ? "border-sky-800/60 bg-sky-950/35 text-sky-100"
                                    : "border-red-800/60 bg-red-950/35 text-red-100"
                                }`}
                              >
                                {a.label}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {m.attachments?.length ? (
                          <ul className="mb-2 flex flex-wrap justify-end gap-2 whitespace-normal">
                            {m.attachments.map((a, j) => (
                              <AttachmentChip key={j} a={a} />
                            ))}
                          </ul>
                        ) : null}
                        {m.role === "model" ? <ChatMarkdown>{m.content}</ChatMarkdown> : m.content}
                        {m.role === "model" && m.quickActions?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {m.quickActions.map((qa) => (
                              <button
                                key={qa.id}
                                type="button"
                                className="rounded-md border border-amber-700/60 bg-amber-950/35 px-3.5 py-1.5 text-sm font-medium text-amber-50 hover:border-amber-500 disabled:opacity-50 sm:text-base"
                                disabled={Boolean(busy)}
                                onClick={() => void sendPrompt(qa.prompt)}
                              >
                                {qa.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {m.role === "model" && m.pendingApproval ? (
                          <ApprovalCard
                            pending={m.pendingApproval}
                            outcome={approvalOutcome(m)}
                            busy={busy}
                            scrollRef={
                              unresolvedApproval?.index === i ? approvalCardRef : undefined
                            }
                            onApprove={() =>
                              void resolveApproval(i, "approve", m.pendingApproval!)
                            }
                            onDeny={() =>
                              void resolveApproval(i, "reject", m.pendingApproval!)
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
                {busy === "chat" ? (
                  <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 text-slate-400">
                    <p>Thinking… you can add to this reply below.</p>
                    <button
                      type="button"
                      className="rounded-md border border-slate-600 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-800 hover:text-white"
                      onClick={stopChat}
                    >
                      Stop
                    </button>
                  </div>
                ) : null}
                <div ref={chatEndRef} />
              </div>

              {chatStatus ? (
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 sm:px-6">
                  <span>{chatStatus}</span>
                  {busy === "chat" ? (
                    <button
                      type="button"
                      className="rounded-md border border-slate-600 px-2.5 py-1 font-medium text-white hover:bg-slate-800"
                      onClick={stopChat}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
              ) : null}

              {skillForm !== null ? (
                <form
                  className="flex shrink-0 flex-wrap items-center gap-2 border-t border-emerald-900/40 bg-emerald-950/20 px-4 py-3 sm:px-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = skillForm.trim();
                    void sendPrompt(
                      `Save what we just did as a reusable skill${name ? ` called “${name}”` : ""}. Generalize it so it works next time with new data.`,
                    );
                  }}
                >
                  <label htmlFor="skill-name" className="text-base text-emerald-50">
                    Skill name
                  </label>
                  <input
                    id="skill-name"
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-slate-500"
                    placeholder="Optional"
                    value={skillForm}
                    onChange={(e) => setSkillForm(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-200 px-3 py-2 font-semibold text-slate-900 disabled:opacity-50"
                    disabled={Boolean(busy)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-3 py-2 text-slate-300 hover:bg-slate-800"
                    onClick={() => {
                      setSkillForm(null);
                      focusPrompt();
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : null}

              {pending.length ? (
                <ul
                  className="flex shrink-0 flex-wrap gap-2 border-t border-slate-800/80 px-4 py-2 sm:px-6"
                  aria-label="Attached files"
                >
                  {pending.map((a, j) => (
                    <AttachmentChip
                      key={`${a.name}-${j}`}
                      a={a}
                      onRemove={() => setPending((prev) => prev.filter((_, k) => k !== j))}
                    />
                  ))}
                </ul>
              ) : null}

              {unresolvedApproval && view === "chat" ? (
                <div className="flex shrink-0 flex-col gap-2 border-t border-amber-700/50 bg-amber-950/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <p className="min-w-0 truncate text-sm font-medium text-amber-50 sm:text-base">
                    Waiting for approval — {unresolvedApproval.pending.summary.split("\n")[0]}
                  </p>
                  <ApprovalButtons
                    pendingId={unresolvedApproval.pending.id}
                    busy={busy}
                    size="lg"
                    onApprove={() =>
                      void resolveApproval(
                        unresolvedApproval.index,
                        "approve",
                        unresolvedApproval.pending,
                      )
                    }
                    onDeny={() =>
                      void resolveApproval(
                        unresolvedApproval.index,
                        "reject",
                        unresolvedApproval.pending,
                      )
                    }
                  />
                </div>
              ) : null}

              <form
                className="flex shrink-0 items-end gap-2 border-t border-slate-800 bg-slate-950 px-3 py-3 sm:gap-3 sm:px-5 sm:py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendPrompt();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ATTACH_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void attachFiles(e.target.files);
                  }}
                />
                <button
                  type="button"
                  className="mb-0.5 rounded-md p-2.5 text-slate-400 hover:bg-slate-900 hover:text-slate-200 disabled:opacity-50"
                  disabled={Boolean(busy) || pending.length >= 3}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach a file"
                  title="Attach"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.2 3.2 0 0 1 4.5 4.5l-9.2 9.2a1.4 1.4 0 1 1-2-2l8.1-8.1" />
                  </svg>
                </button>
                <textarea
                  ref={promptRef}
                  rows={1}
                  className="max-h-40 min-h-[3.25rem] min-w-0 flex-1 resize-none rounded-md border border-slate-600 bg-slate-900 px-4 py-3.5 text-lg leading-relaxed text-white outline-none placeholder:text-slate-500 focus:border-slate-400"
                  placeholder={
                    busy === "chat"
                      ? "Add to this reply (e.g. include HIIT)…"
                      : pending.length
                        ? "What should I do with it?"
                        : "Message"
                  }
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && busy === "chat") {
                      e.preventDefault();
                      stopChat();
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      // While thinking, Enter steers (abort+retry with combined prompt).
                      if (busy && busy !== "chat") return;
                      void sendPrompt();
                    }
                  }}
                  aria-label="Ask the family assistant"
                />
                {busy === "chat" ? (
                  <button
                    type="button"
                    className="mb-0.5 rounded-md border border-amber-600/70 bg-amber-950/40 px-4 py-3 text-base font-semibold text-amber-50 hover:border-amber-500 hover:bg-amber-950/70"
                    onClick={stopChat}
                    aria-label="Stop generating"
                  >
                    Stop
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="mb-0.5 rounded-md bg-slate-100 px-5 py-3 text-base font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
                  disabled={
                    (!input.trim() && !pending.length) ||
                    (Boolean(busy) && busy !== "chat")
                  }
                >
                  {busy === "chat" ? "Add" : "Send"}
                </button>
              </form>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
