"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { WikiBrowser } from "@/components/WikiBrowser";
import type { ChatSessionMeta, StoredChatTurn } from "@/lib/agent-chat-sessions";
import {
  fbBtnApprove,
  fbBtnApproveLg,
  fbBtnChip,
  fbBtnDeny,
  fbBtnDenyLg,
  fbBtnSecondarySm,
} from "@/lib/ui-buttons";

type Status = {
  googleLinked?: boolean;
  googleConfigured?: boolean;
  geminiConfigured?: boolean;
  wikilmGithubConfigured?: boolean;
  gmailReady?: boolean;
  inboxAutoScanMinutes?: number;
  slackConfigured?: boolean;
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
  approvalResolved?: "approved" | "rejected";
};

type SkillMeta = { path: string; title: string; summary: string; category: string };

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

type AiView = "chat" | "wiki";

const VIEW_STORAGE_KEY = "familyboard-ai-view";
const SESSION_STORAGE_KEY = "familyboard-chat-session";
const WIKI_WRITE_TOOLS = new Set([
  "create_wiki_page",
  "edit_wiki_section",
  "rewrite_wiki_page",
  "move_wiki_page",
  "delete_wiki_page",
  "save_skill",
]);
const CALENDAR_WRITE_TOOLS = new Set(["create_event", "update_event", "delete_event"]);
const ATTACH_ACCEPT = ".csv,.tsv,.xlsx,.xlsm,.txt,.md,.json,.ics,.jpg,.jpeg,.png,.gif,.webp,text/*,image/jpeg,image/png,image/gif,image/webp";

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

function parseView(raw: string | null | undefined): AiView | null {
  return raw === "chat" || raw === "wiki" ? raw : null;
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
  /** Board floating chat vs full AI tab. */
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [wikiFocus, setWikiFocus] = useState<{ path: string; nonce: number } | null>(null);
  const storedView = useSyncExternalStore(subscribeNoop, readInitialView, () => "chat" as AiView);
  const [pickedView, setPickedView] = useState<AiView | null>(null);
  const view = isOverlay ? "chat" : (pickedView ?? storedView);

  let unresolvedApproval: { index: number; pending: PendingApproval } | null = null;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (m.role === "model" && m.pendingApproval && !m.approvalResolved) {
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

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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
      setChat((json.session?.turns ?? []) as ChatTurn[]);
      rememberSessionId(id);
      setChatStatus(null);
      setSkillForm(null);
      setPending([]);
      setInput("");
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
    } catch (e) {
      if (signalArg?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load AI tab");
    }
  }, []);

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

  async function sendPrompt(raw?: string) {
    const text = (raw ?? input).trim();
    const files = raw === undefined ? pending : [];
    if ((!text && !files.length) || busy) return;
    setBusy("chat");
    setError(null);
    setChatStatus(null);
    setSkillForm(null);
    const nextChat: ChatTurn[] = [
      ...chat,
      { role: "user", content: text, ...(files.length ? { attachments: files } : {}) },
    ];
    setChat(nextChat);
    setInput("");
    if (files.length) setPending([]);
    focusPrompt();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    const statusTimer = window.setTimeout(() => {
      setChatStatus("Still working (Gemini may be retrying) — hit Stop anytime.");
    }, 4000);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextChat.map(({ role, content, attachments }) => ({ role, content, attachments })),
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
      if (ac.signal.aborted) {
        setChatStatus("Stopped.");
      } else {
        setError(friendlyChatError(e));
      }
      setChat(chat);
      setInput(text);
      if (files.length) setPending(files);
    } finally {
      window.clearTimeout(statusTimer);
      chatAbortRef.current = null;
      setBusy(null);
      setChatStatus((prev) => (prev === "Stopped." ? prev : null));
      focusPrompt();
    }
  }

  async function resolveApproval(
    turnIndex: number,
    decision: "approve" | "reject",
    pending: PendingApproval,
  ) {
    if (busy) return;
    setBusy(`${decision}-${pending.id}`);
    setError(null);
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
      let persisted: ChatTurn[] | null = null;
      setChat((prev) => {
        const next = [...prev];
        const turn = next[turnIndex];
        if (!turn || turn.role !== "model") return prev;
        next[turnIndex] = {
          ...turn,
          approvalResolved: decision === "approve" ? "approved" : "rejected",
          actions: [...(turn.actions ?? []), ...(json.actions ?? [])],
        };
        next.push({
          role: "model",
          content: json.reply || (decision === "approve" ? "Applied." : "Denied — nothing was written."),
          actions: json.actions ?? [],
        });
        persisted = next;
        return next;
      });
      if (persisted) void persistSession(persisted);
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
      setError(e instanceof Error ? e.message : "approve_error");
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
            {(["chat", "wiki"] as const).map((v) => (
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
                {v === "chat" ? "Chat" : "Wiki"}
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
                    className="max-h-64"
                    sessions={sessions}
                    sessionId={sessionId}
                    onSelect={(id) => {
                      setSessionsOpen(false);
                      void loadSession(id);
                    }}
                    onDelete={(id) => void deleteSession(id)}
                  />
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
              className={`relative rounded-md px-3 py-1.5 text-sm font-medium ${
                toolsOpen
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
              onClick={() => setToolsOpen((o) => !o)}
              aria-expanded={toolsOpen}
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
        {!isOverlay && view === "chat" ? (
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
                onClick={() => void startNewSession()}
              >
                + New
              </button>
            </div>
            <ChatSessionList
              sessions={sessions}
              sessionId={sessionId}
              onSelect={(id) => void loadSession(id)}
              onDelete={(id) => void deleteSession(id)}
            />
          </aside>
        ) : null}
        <section
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={view === "wiki" ? "Family wiki" : "Chat"}
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
                          <div
                            ref={
                              !m.approvalResolved &&
                              chat
                                .slice(i + 1)
                                .every((later) => !later.pendingApproval || later.approvalResolved)
                                ? approvalCardRef
                                : undefined
                            }
                            className="mt-4 rounded-2xl border border-amber-600/60 bg-amber-950/40 px-4 py-3.5 text-base leading-relaxed text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.12)]"
                          >
                            <p className="mb-2 font-semibold text-amber-50">
                              {m.approvalResolved === "approved"
                                ? "Approved"
                                : m.approvalResolved === "rejected"
                                  ? "Denied"
                                  : "Needs your approval to write"}
                            </p>
                            <pre className="mb-3 whitespace-pre-wrap font-sans text-[1.05rem] leading-[1.55] text-amber-50/95">
                              {m.pendingApproval.summary}
                            </pre>
                            {!m.approvalResolved ? (
                              <ApprovalButtons
                                pendingId={m.pendingApproval.id}
                                busy={busy}
                                onApprove={() =>
                                  void resolveApproval(i, "approve", m.pendingApproval!)
                                }
                                onDeny={() =>
                                  void resolveApproval(i, "reject", m.pendingApproval!)
                                }
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
                {busy === "chat" ? (
                  <div className="mx-auto flex max-w-3xl items-center gap-3 text-slate-400">
                    <p>Thinking…</p>
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
                      ? "Still thinking… type the next message"
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
                      if (busy === "chat") return;
                      void sendPrompt();
                    }
                  }}
                  aria-label="Ask the family assistant"
                />
                {busy === "chat" ? (
                  <button
                    type="button"
                    className="mb-0.5 rounded-md border border-amber-600/70 bg-amber-950/40 px-5 py-3 text-base font-semibold text-amber-50 hover:border-amber-500 hover:bg-amber-950/70"
                    onClick={stopChat}
                    aria-label="Stop generating"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="mb-0.5 rounded-md bg-slate-100 px-5 py-3 text-base font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
                    disabled={!input.trim() && !pending.length}
                  >
                    Send
                  </button>
                )}
              </form>
            </>
          )}
        </section>

        {/* Tools drawer — inbox / todos / slack, off by default (full AI tab only) */}
        {toolsOpen && !isOverlay ? (
          <>
            <button
              type="button"
              className="absolute inset-0 z-20 bg-black/40 lg:bg-transparent"
              aria-label="Close tools"
              onClick={() => setToolsOpen(false)}
            />
            <aside
              id="ai-tools-panel"
              className="board-scrollbar absolute inset-y-0 right-0 z-30 flex w-[min(100%,22rem)] flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Tools</h2>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
                  onClick={() => setToolsOpen(false)}
                >
                  Close
                </button>
              </div>

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
                        setToolsOpen(false);
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
                    page to check them off.
                  </p>
                ) : (
                  <p>
                    Ask the assistant to list or add todos. Link the GitHub wiki to keep them on{" "}
                    <code className="text-slate-200">todos/list.md</code>.
                  </p>
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
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
