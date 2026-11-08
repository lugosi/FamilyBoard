"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { WikiBrowser } from "@/components/WikiBrowser";

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

type FamilyTodo = {
  id: string;
  title: string;
  notes?: string;
  dueHint?: string;
  done: boolean;
  createdAt: string;
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

const SUGGESTIONS = [
  "House dashboard",
  "What's on the calendar this week?",
  "Add dentist for Maya next Tuesday at 3pm",
  "Move Saturday's soccer to 10am",
  "Check the inbox",
];
const WIKI_SUGGESTIONS = ["Remember that Maya's shoe size is 2", "What's the Wi-Fi password?"];

type AiView = "chat" | "wiki";

const VIEW_STORAGE_KEY = "familyboard-ai-view";
const WIKI_WRITE_TOOLS = new Set([
  "create_wiki_page",
  "edit_wiki_section",
  "rewrite_wiki_page",
  "move_wiki_page",
  "delete_wiki_page",
  "save_skill",
]);
const ATTACH_ACCEPT = ".csv,.tsv,.xlsx,.xlsm,.txt,.md,.json,.ics,.jpg,.jpeg,.png,.gif,.webp,text/*,image/jpeg,image/png,image/gif,image/webp";

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

export function WikiLlm({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [todos, setTodos] = useState<FamilyTodo[]>([]);
  const [slack, setSlack] = useState<SlackSnapshot | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skillForm, setSkillForm] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const initialView = useSyncExternalStore(subscribeNoop, readInitialView, () => null);
  const [pickedView, setPickedView] = useState<AiView | null>(null);
  const view: AiView = pickedView ?? initialView ?? "chat";
  const [wikiRefreshKey, setWikiRefreshKey] = useState(0);
  const loadedOnceRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async (signalArg?: AbortSignal) => {
    setError(null);
    try {
      const statusRes = await fetch("/api/auth/status", { signal: signalArg });
      const statusJson = (await statusRes.json()) as Status;
      if (signalArg?.aborted) return;
      setStatus(statusJson);

      const todosRes = await fetch("/api/todos", { signal: signalArg });
      if (todosRes.ok) {
        const t = (await todosRes.json()) as { todos: FamilyTodo[] };
        setTodos(t.todos ?? []);
      }

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
      setChatStatus("Still working (Gemini may be retrying) — you can cancel.");
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
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || `Assistant failed (${res.status})`);
      setChat([
        ...nextChat,
        {
          role: "model",
          content: json.reply || "",
          actions: json.actions ?? [],
          ...(json.quickActions?.length ? { quickActions: json.quickActions } : {}),
        },
      ]);
      if (json.actions?.some((a) => a.ok && WIKI_WRITE_TOOLS.has(a.tool))) {
        setWikiRefreshKey((k) => k + 1);
      }
      if (
        json.actions?.some(
          (a) => a.ok && !a.tool.includes("wiki") && a.tool !== "find_events",
        )
      ) {
        void refresh();
      }
    } catch (e) {
      if (ac.signal.aborted) {
        setChatStatus("Cancelled.");
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
      setChatStatus((prev) => (prev === "Cancelled." ? prev : null));
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
        added?: FamilyTodo[];
        events?: { summary: string; ok: boolean; error?: string }[];
        scanned?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || `Scan failed (${res.status})`);
      const todosAdded = json.added?.length ?? 0;
      const eventsAdded = json.events?.filter((e) => e.ok).length ?? 0;
      const failed = json.events?.filter((e) => !e.ok) ?? [];
      setNote(
        `Scanned ${json.scanned ?? 0} email(s): ${todosAdded} todo(s), ${eventsAdded} calendar event(s).` +
          (failed.length
            ? ` Could not add: ${failed.map((f) => f.summary).join(", ")}.`
            : ""),
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan_error");
    } finally {
      setBusy(null);
    }
  }

  async function todoAction(action: "complete" | "uncomplete" | "remove", id: string) {
    setBusy(`todo-${id}`);
    try {
      const res = await fetch("/api/todos/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) {
        const json = await parseJsonSafe<{ error?: string }>(res);
        throw new Error(json.error || "todo_error");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "todo_error");
    } finally {
      setBusy(null);
    }
  }

  const panel =
    "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-slate-950/40";
  const sideBtn =
    "rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
  const chipBtn =
    "rounded-xl border border-slate-600 bg-slate-950/70 px-3.5 py-2.5 text-left text-sm leading-snug text-slate-100 hover:border-slate-400 hover:bg-slate-900 disabled:opacity-50 sm:text-base";
  const unprocessed = messages.filter((m) => !m.processed).length;
  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);

  const capabilities = [
    { label: "Calendar", on: Boolean(status?.googleLinked) },
    { label: "Inbox", on: Boolean(status?.gmailReady) },
    { label: "Wiki", on: Boolean(status?.wikilmGithubConfigured) },
    { label: "Slack", on: Boolean(slack?.bot?.connected) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-base text-slate-100 sm:text-lg">
      <div className="box-border flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-3 sm:gap-4 sm:px-5 sm:py-4 lg:px-8">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Assistant
            </h1>
            <ul className="flex flex-wrap gap-2 text-sm" aria-label="Assistant capabilities">
              {capabilities.map((c) => (
                <li
                  key={c.label}
                  className={`rounded-full border px-3 py-1 ${
                    c.on
                      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-100"
                      : "border-slate-700 bg-slate-900 text-slate-500"
                  }`}
                >
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-base text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
            aria-label="Refresh AI tab"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="shrink-0 rounded-xl border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-base text-amber-50">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-base text-slate-100">
            {note}
          </p>
        ) : null}

        <div className="board-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,2.2fr)_minmax(20rem,1fr)] lg:overflow-hidden">
          {/* Prompt */}
          <section
            className={`${panel} relative min-h-[28rem] p-4 sm:p-5`}
            aria-label={view === "wiki" ? "Family wiki" : "Assistant"}
            onDragOver={(e) => {
              if (view !== "chat" || !status?.geminiConfigured || !e.dataTransfer.types.includes("Files")) return;
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
              <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-600/70 bg-slate-950/85 text-base text-emerald-100 sm:text-lg">
                Drop a spreadsheet or text file to attach it
              </div>
            ) : null}
            <div
              role="tablist"
              aria-label="Assistant view"
              className="mb-4 flex shrink-0 gap-1 self-start rounded-xl border border-slate-800 bg-slate-950/60 p-1 text-base"
            >
              {(["chat", "wiki"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={`rounded-lg px-4 py-2 font-medium ${
                    view === v ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                  onClick={() => {
                    setPickedView(v);
                    try {
                      localStorage.setItem(VIEW_STORAGE_KEY, v);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {v === "chat" ? "Chat" : "Wiki"}
                </button>
              ))}
            </div>
            {view === "wiki" ? (
              <WikiBrowser
                active={active && view === "wiki"}
                configured={Boolean(status?.wikilmGithubConfigured)}
                refreshKey={wikiRefreshKey}
              />
            ) : !status?.geminiConfigured ? (
              <p className="text-base text-slate-300 sm:text-lg">
                Set <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-100">GEMINI_API_KEY</code> to use
                the family assistant. Link Google to let it read and update the
                calendar.
              </p>
            ) : (
              <>
                <div className="board-scrollbar mb-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
                  {chat.length === 0 ? (
                    <div className="flex h-full flex-col justify-center gap-5 text-slate-300">
                      <div className="space-y-2">
                        <p className="text-xl font-medium text-white sm:text-2xl">
                          What do you need?
                        </p>
                        <p className="max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
                          Ask about the calendar, control lights or litter, check the house
                          {status?.wikilmGithubConfigured
                            ? ", or save something to the family wiki"
                            : ""}
                          .
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {[...SUGGESTIONS, ...(status?.wikilmGithubConfigured ? WIKI_SUGGESTIONS : [])].map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={chipBtn}
                            onClick={() => void sendPrompt(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      {skills.length ? (
                        <div>
                          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                            Your skills
                          </p>
                          <div className="flex flex-wrap gap-2.5">
                            {skills.map((sk) => (
                              <button
                                key={sk.path}
                                type="button"
                                title={sk.summary}
                                className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3.5 py-2.5 text-left text-sm text-emerald-50 hover:border-emerald-600 sm:text-base"
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
                      ) : null}
                      <p className="text-sm text-slate-500 sm:text-base">
                        Tip: attach a spreadsheet, say what to do with it, then save the chat as a skill.
                      </p>
                    </div>
                  ) : (
                    chat.map((m, i) => (
                      <div
                        key={`${m.role}-${i}`}
                        className={m.role === "user" ? "flex justify-end" : ""}
                      >
                        <div
                          className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 ${
                            m.role === "user"
                              ? "bg-slate-800 text-base leading-relaxed text-slate-50 whitespace-pre-wrap sm:text-lg"
                              : "bg-slate-950/85 text-slate-100"
                          }`}
                        >
                          {m.actions?.length ? (
                            <ul className="mb-2.5 flex flex-wrap gap-2">
                              {m.actions.map((a, j) => (
                                <li
                                  key={j}
                                  className={`rounded-lg border px-2.5 py-1 text-sm ${
                                    a.ok
                                      ? "border-sky-800/70 bg-sky-950/40 text-sky-100"
                                      : "border-red-800/70 bg-red-950/40 text-red-100"
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
                          {m.role === "model" ? (
                            <ChatMarkdown>{m.content}</ChatMarkdown>
                          ) : (
                            m.content
                          )}
                          {m.role === "model" && m.quickActions?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {m.quickActions.map((qa) => (
                                <button
                                  key={qa.id}
                                  type="button"
                                  className="rounded-xl border border-amber-600/70 bg-amber-950/45 px-3.5 py-2 text-sm font-medium text-amber-50 hover:border-amber-400 disabled:opacity-50 sm:text-base"
                                  disabled={Boolean(busy)}
                                  onClick={() => void sendPrompt(qa.prompt)}
                                >
                                  {qa.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                  {busy === "chat" ? (
                    <p className="text-base text-slate-400">Thinking…</p>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>
                {chatStatus ? (
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-base text-slate-100">
                    <span>{chatStatus}</span>
                    {busy === "chat" ? (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
                        onClick={() => chatAbortRef.current?.abort()}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {skillForm !== null ? (
                  <form
                    className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-base"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = skillForm.trim();
                      void sendPrompt(
                        `Save what we just did as a reusable skill${name ? ` called “${name}”` : ""}. Generalize it so it works next time with new data.`,
                      );
                    }}
                  >
                    <label htmlFor="skill-name" className="text-emerald-50">
                      Save this conversation as a skill
                    </label>
                    <input
                      id="skill-name"
                      autoFocus
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-slate-500"
                      placeholder="Name (optional), e.g. Soccer schedule to calendar"
                      value={skillForm}
                      onChange={(e) => setSkillForm(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-emerald-200 px-4 py-2.5 font-semibold text-slate-900 hover:bg-emerald-100 disabled:opacity-50"
                      disabled={Boolean(busy)}
                    >
                      Save skill
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-600 px-3 py-2.5 text-slate-200 hover:bg-slate-800"
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
                  <ul className="mb-3 flex shrink-0 flex-wrap gap-2" aria-label="Attached files">
                    {pending.map((a, j) => (
                      <AttachmentChip
                        key={`${a.name}-${j}`}
                        a={a}
                        onRemove={() => setPending((prev) => prev.filter((_, k) => k !== j))}
                      />
                    ))}
                  </ul>
                ) : null}
                <form
                  className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end"
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
                    className="rounded-xl border border-slate-700 px-4 py-3 text-base text-slate-200 hover:bg-slate-800 disabled:opacity-50 sm:self-stretch"
                    disabled={Boolean(busy) || pending.length >= 3}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach a file"
                    title="Attach a spreadsheet or text file"
                  >
                    {busy === "attach" ? "Reading…" : "Attach"}
                  </button>
                  <textarea
                    ref={promptRef}
                    rows={2}
                    className="min-h-[3.25rem] min-w-0 flex-1 resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base leading-relaxed text-white outline-none focus:border-slate-400 disabled:opacity-60 sm:min-h-[4rem] sm:text-lg"
                    placeholder={
                      busy === "chat"
                        ? "Still thinking… type the next message"
                        : pending.length
                          ? "What should I do with it?"
                          : "Ask anything — Enter to send, Shift+Enter for a new line"
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendPrompt();
                      }
                    }}
                    aria-label="Ask the family assistant"
                  />
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
                    {chat.some((m) => m.role === "model") &&
                    busy !== "chat" &&
                    skillForm === null &&
                    status?.wikilmGithubConfigured ? (
                      <button
                        type="button"
                        className="rounded-xl border border-emerald-800/70 px-4 py-3 text-base text-emerald-50 hover:bg-emerald-950/40"
                        onClick={() => setSkillForm("")}
                        title="Save this conversation as a reusable skill"
                      >
                        Save skill
                      </button>
                    ) : null}
                    {chat.length > 0 && busy !== "chat" ? (
                      <button
                        type="button"
                        className="rounded-xl border border-slate-700 px-4 py-3 text-base text-slate-200 hover:bg-slate-800"
                        onClick={() => {
                          setChat([]);
                          setChatStatus(null);
                          setSkillForm(null);
                        }}
                      >
                        New chat
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      className="rounded-xl bg-slate-100 px-5 py-3 text-base font-semibold text-slate-900 hover:bg-white disabled:opacity-50"
                      disabled={Boolean(busy) || (!input.trim() && !pending.length)}
                    >
                      {busy === "chat" ? "Working…" : "Send"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>

          {/* Side column */}
          <div className="board-scrollbar flex min-h-0 flex-col gap-4 lg:overflow-y-auto">
            <section className={`${panel} shrink-0 p-4`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-white sm:text-xl">
                  Inbox
                  {unprocessed ? (
                    <span className="ml-2 text-sm font-normal text-slate-400">
                      {unprocessed} new
                    </span>
                  ) : null}
                </h2>
                <button
                  type="button"
                  className={sideBtn}
                  disabled={Boolean(busy) || !status?.gmailReady || !status?.geminiConfigured}
                  onClick={() => void scanInbox()}
                >
                  {busy === "scan" ? "Scanning…" : "Scan inbox"}
                </button>
              </div>
              {!status?.googleConfigured ? (
                <p className="text-base text-slate-400">
                  Configure Google OAuth, then Link Google (re-link after enabling
                  Gmail API + scopes).
                </p>
              ) : !status?.gmailReady ? (
                <p className="text-base text-slate-400">
                  <a className="text-sky-300 underline" href="/api/auth/google">
                    Link Google
                  </a>{" "}
                  to use the inbox drop-box.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-slate-500">
                    Forwarded mail becomes todos and calendar events
                    {status.inboxAutoScanMinutes
                      ? ` · auto-scan every ${status.inboxAutoScanMinutes} min`
                      : ""}
                    .
                  </p>
                  <ul className="board-scrollbar max-h-48 space-y-2.5 overflow-y-auto text-base">
                    {messages.length === 0 ? (
                      <li className="text-slate-500">
                        Forward actionable mail here, then Scan inbox.
                      </li>
                    ) : (
                      messages.slice(0, 8).map((m) => (
                        <li
                          key={m.id}
                          className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium text-slate-50">
                              {m.subject}
                            </span>
                            {m.processed ? (
                              <span className="shrink-0 text-sm text-slate-500">done</span>
                            ) : null}
                          </div>
                          <div className="truncate text-sm text-slate-400">{m.from}</div>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </section>

            <section className={`${panel} shrink-0 p-4`}>
              <h2 className="mb-3 text-lg font-semibold text-white sm:text-xl">
                Todos
                {openTodos.length ? (
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    {openTodos.length} open
                  </span>
                ) : null}
              </h2>
              <ul className="board-scrollbar max-h-64 space-y-2 overflow-y-auto text-base">
                {todos.length === 0 ? (
                  <li className="text-slate-500">No todos yet.</li>
                ) : (
                  [...openTodos, ...doneTodos].map((t) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5"
                    >
                      <input
                        type="checkbox"
                        className="mt-1.5 h-4 w-4"
                        checked={t.done}
                        disabled={busy === `todo-${t.id}`}
                        onChange={() =>
                          void todoAction(t.done ? "uncomplete" : "complete", t.id)
                        }
                        aria-label={t.done ? "Mark incomplete" : "Mark complete"}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`font-medium leading-snug ${t.done ? "text-slate-500 line-through" : "text-slate-50"}`}
                        >
                          {t.title}
                        </div>
                        {t.notes ? (
                          <div className="mt-0.5 text-sm text-slate-400">{t.notes}</div>
                        ) : null}
                        {t.dueHint ? (
                          <div className="text-sm text-slate-500">Due: {t.dueHint}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-sm text-slate-500 hover:text-red-300"
                        disabled={busy === `todo-${t.id}`}
                        onClick={() => void todoAction("remove", t.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className={`${panel} shrink-0 p-4`} aria-label="Slack">
              <h2 className="mb-3 text-lg font-semibold text-white sm:text-xl">Slack</h2>
              {!status?.slackConfigured ? (
                <p className="text-base text-slate-400">
                  Chat with the assistant from the Slack app: DM the bot or
                  @mention it in a channel. Set{" "}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">SLACK_BOT_TOKEN</code> and{" "}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">SLACK_APP_TOKEN</code> (see
                  docs/SLACK_SETUP.md).
                </p>
              ) : !slack ? (
                <p className="text-base text-slate-500">Loading…</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
                  <dt className="text-slate-500">Workspace</dt>
                  <dd className="text-slate-100">{slack.team || "—"}</dd>
                  <dt className="text-slate-500">Bot</dt>
                  <dd className="text-slate-100">{slack.botName ? `@${slack.botName}` : "—"}</dd>
                  <dt className="text-slate-500">Connected</dt>
                  <dd className={slack.bot?.connected ? "text-slate-100" : "text-amber-200"}>
                    {slack.bot?.connected
                      ? `yes (connected ${timeAgo(slack.bot.connectedAt)})`
                      : slack.bot?.running
                        ? "reconnecting…"
                        : "no (restart the app)"}
                  </dd>
                  <dt className="text-slate-500">Replies</dt>
                  <dd className="tabular-nums text-slate-100">
                    {slack.bot?.handled ?? 0}
                    {slack.bot?.lastEventAt ? ` · last ${timeAgo(slack.bot.lastEventAt)}` : ""}
                  </dd>
                  {slack.error || slack.bot?.lastError ? (
                    <>
                      <dt className="text-slate-500">Error</dt>
                      <dd className="text-amber-200">{slack.error ?? slack.bot?.lastError}</dd>
                    </>
                  ) : null}
                </dl>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
