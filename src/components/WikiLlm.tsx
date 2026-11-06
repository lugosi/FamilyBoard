"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type ChatTurn = {
  role: "user" | "model";
  content: string;
  actions?: AgentAction[];
};

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
  "What's on the calendar this week?",
  "Add dentist for Maya next Tuesday at 3pm",
  "Move Saturday's soccer to 10am",
  "Check the inbox",
];

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

export function WikiLlm({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [todos, setTodos] = useState<FamilyTodo[]>([]);
  const [slack, setSlack] = useState<SlackSnapshot | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
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

  async function sendPrompt(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setBusy("chat");
    setError(null);
    setChatStatus(null);
    const nextChat: ChatTurn[] = [...chat, { role: "user", content: text }];
    setChat(nextChat);
    setInput("");
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
          messages: nextChat.map(({ role, content }) => ({ role, content })),
        }),
        signal: ac.signal,
      });
      const json = await parseJsonSafe<{
        reply?: string;
        actions?: AgentAction[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || `Assistant failed (${res.status})`);
      setChat([
        ...nextChat,
        { role: "model", content: json.reply || "", actions: json.actions ?? [] },
      ]);
      if (json.actions?.some((a) => a.ok && a.tool !== "find_events")) {
        void refresh();
      }
    } catch (e) {
      if (ac.signal.aborted) {
        setChatStatus("Cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "chat_error");
      }
      setChat(chat);
      setInput(text);
    } finally {
      window.clearTimeout(statusTimer);
      chatAbortRef.current = null;
      setBusy(null);
      setChatStatus((prev) => (prev === "Cancelled." ? prev : null));
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
    "flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-slate-950/40";
  const smallBtn =
    "rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50";
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-base text-slate-100">
      <div className="box-border flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
              WikiLLM
            </h1>
            <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Assistant capabilities">
              {capabilities.map((c) => (
                <li
                  key={c.label}
                  className={`rounded-full border px-2 py-0.5 ${
                    c.on
                      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
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
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
            aria-label="Refresh AI tab"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="shrink-0 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200">
            {note}
          </p>
        ) : null}

        <div className="board-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:overflow-hidden">
          {/* Prompt */}
          <section className={`${panel} min-h-[24rem] p-3 sm:p-4`} aria-label="Assistant">
            {!status?.geminiConfigured ? (
              <p className="text-sm text-slate-400">
                Set <code className="text-slate-300">GEMINI_API_KEY</code> to use
                the family assistant. Link Google to let it read and update the
                calendar.
              </p>
            ) : (
              <>
                <div className="board-scrollbar mb-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
                  {chat.length === 0 ? (
                    <div className="flex h-full flex-col justify-center gap-3 text-slate-400">
                      <p>
                        Ask anything, or tell it what to change. It can read and
                        update the calendar, manage todos, process the inbox
                        {status?.wikilmGithubConfigured ? ", and use the family wiki" : ""}.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-left text-xs text-slate-200 hover:border-slate-500"
                            onClick={() => void sendPrompt(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chat.map((m, i) => (
                      <div
                        key={`${m.role}-${i}`}
                        className={m.role === "user" ? "flex justify-end" : ""}
                      >
                        <div
                          className={`max-w-[90%] rounded-lg px-3 py-2 whitespace-pre-wrap ${
                            m.role === "user"
                              ? "bg-slate-800 text-slate-100"
                              : "bg-slate-950/80 text-slate-200"
                          }`}
                        >
                          {m.actions?.length ? (
                            <ul className="mb-2 flex flex-wrap gap-1.5">
                              {m.actions.map((a, j) => (
                                <li
                                  key={j}
                                  className={`rounded-md border px-2 py-0.5 text-xs ${
                                    a.ok
                                      ? "border-sky-800/70 bg-sky-950/40 text-sky-200"
                                      : "border-red-800/70 bg-red-950/40 text-red-200"
                                  }`}
                                >
                                  {a.label}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {m.content}
                        </div>
                      </div>
                    ))
                  )}
                  {busy === "chat" ? (
                    <p className="text-xs text-slate-500">Thinking…</p>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>
                {chatStatus ? (
                  <div className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-200">
                    <span>{chatStatus}</span>
                    {busy === "chat" ? (
                      <button
                        type="button"
                        className="rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800"
                        onClick={() => chatAbortRef.current?.abort()}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <form
                  className="flex shrink-0 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendPrompt();
                  }}
                >
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-slate-500"
                    placeholder="e.g. Piano lessons every… / What's Saturday look like?"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={busy === "chat"}
                    aria-label="Ask the family assistant"
                  />
                  {chat.length > 0 && busy !== "chat" ? (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                      onClick={() => {
                        setChat([]);
                        setChatStatus(null);
                      }}
                    >
                      New
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                    disabled={busy === "chat" || !input.trim()}
                  >
                    {busy === "chat" ? "Working…" : "Send"}
                  </button>
                </form>
              </>
            )}
          </section>

          {/* Side column */}
          <div className="board-scrollbar flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
            <section className={`${panel} shrink-0 p-3`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-white">
                  Inbox
                  {unprocessed ? (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {unprocessed} new
                    </span>
                  ) : null}
                </h2>
                <button
                  type="button"
                  className={smallBtn}
                  disabled={Boolean(busy) || !status?.gmailReady || !status?.geminiConfigured}
                  onClick={() => void scanInbox()}
                >
                  {busy === "scan" ? "Scanning…" : "Scan inbox"}
                </button>
              </div>
              {!status?.googleConfigured ? (
                <p className="text-sm text-slate-400">
                  Configure Google OAuth, then Link Google (re-link after enabling
                  Gmail API + scopes).
                </p>
              ) : !status?.gmailReady ? (
                <p className="text-sm text-slate-400">
                  <a className="text-sky-300 underline" href="/api/auth/google">
                    Link Google
                  </a>{" "}
                  to use the inbox drop-box.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-slate-500">
                    Forwarded mail becomes todos and calendar events
                    {status.inboxAutoScanMinutes
                      ? ` · auto-scan every ${status.inboxAutoScanMinutes} min`
                      : ""}
                    .
                  </p>
                  <ul className="board-scrollbar max-h-40 space-y-2 overflow-y-auto text-sm">
                    {messages.length === 0 ? (
                      <li className="text-slate-500">
                        Forward actionable mail here, then Scan inbox.
                      </li>
                    ) : (
                      messages.slice(0, 8).map((m) => (
                        <li
                          key={m.id}
                          className="rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium text-slate-100">
                              {m.subject}
                            </span>
                            {m.processed ? (
                              <span className="shrink-0 text-xs text-slate-500">done</span>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-slate-400">{m.from}</div>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </section>

            <section className={`${panel} shrink-0 p-3`}>
              <h2 className="mb-2 text-base font-semibold text-white">
                Todos
                {openTodos.length ? (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {openTodos.length} open
                  </span>
                ) : null}
              </h2>
              <ul className="board-scrollbar max-h-56 space-y-1.5 overflow-y-auto text-sm">
                {todos.length === 0 ? (
                  <li className="text-slate-500">No todos yet.</li>
                ) : (
                  [...openTodos, ...doneTodos].map((t) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={t.done}
                        disabled={busy === `todo-${t.id}`}
                        onChange={() =>
                          void todoAction(t.done ? "uncomplete" : "complete", t.id)
                        }
                        aria-label={t.done ? "Mark incomplete" : "Mark complete"}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`font-medium ${t.done ? "text-slate-500 line-through" : "text-slate-100"}`}
                        >
                          {t.title}
                        </div>
                        {t.notes ? (
                          <div className="text-xs text-slate-400">{t.notes}</div>
                        ) : null}
                        {t.dueHint ? (
                          <div className="text-xs text-slate-500">Due: {t.dueHint}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-slate-500 hover:text-red-300"
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

            <section className={`${panel} shrink-0 p-3`} aria-label="Slack">
              <h2 className="mb-2 text-base font-semibold text-white">Slack</h2>
              {!status?.slackConfigured ? (
                <p className="text-sm text-slate-400">
                  Chat with the assistant from the Slack app: DM the bot or
                  @mention it in a channel. Set{" "}
                  <code className="text-slate-300">SLACK_BOT_TOKEN</code> and{" "}
                  <code className="text-slate-300">SLACK_APP_TOKEN</code> (see
                  docs/SLACK_SETUP.md).
                </p>
              ) : !slack ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">Workspace</dt>
                  <dd className="text-slate-200">{slack.team || "—"}</dd>
                  <dt className="text-slate-500">Bot</dt>
                  <dd className="text-slate-200">{slack.botName ? `@${slack.botName}` : "—"}</dd>
                  <dt className="text-slate-500">Connected</dt>
                  <dd className={slack.bot?.connected ? "text-slate-200" : "text-amber-200"}>
                    {slack.bot?.connected
                      ? `yes (connected ${timeAgo(slack.bot.connectedAt)})`
                      : slack.bot?.running
                        ? "reconnecting…"
                        : "no (restart the app)"}
                  </dd>
                  <dt className="text-slate-500">Replies</dt>
                  <dd className="tabular-nums text-slate-200">
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
