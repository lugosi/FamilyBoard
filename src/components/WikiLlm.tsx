"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  googleLinked?: boolean;
  googleConfigured?: boolean;
  geminiConfigured?: boolean;
  wikilmGithubConfigured?: boolean;
  gmailReady?: boolean;
};

type WikiPageMeta = { path: string; title: string; sha?: string };

type ChatTurn = { role: "user" | "model"; content: string };

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

export function WikiLlm() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [todos, setTodos] = useState<FamilyTodo[]>([]);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [saveTitle, setSaveTitle] = useState("");
  const [saveContent, setSaveContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const statusRes = await fetch("/api/auth/status", { signal });
      const statusJson = (await statusRes.json()) as Status;
      if (signal?.aborted) return;
      setStatus(statusJson);

      const todosRes = await fetch("/api/todos", { signal });
      if (todosRes.ok) {
        const t = (await todosRes.json()) as { todos: FamilyTodo[] };
        setTodos(t.todos ?? []);
      }

      if (statusJson.wikilmGithubConfigured) {
        const pagesRes = await fetch("/api/wiki/pages", { signal });
        if (pagesRes.ok) {
          const p = (await pagesRes.json()) as { pages: WikiPageMeta[] };
          setPages(p.pages ?? []);
        }
      } else {
        setPages([]);
      }

      if (statusJson.gmailReady) {
        const gmailRes = await fetch("/api/gmail", { signal });
        if (gmailRes.ok) {
          const g = (await gmailRes.json()) as { messages: GmailMessage[] };
          setMessages(g.messages ?? []);
        } else if (gmailRes.status === 403) {
          setError("Gmail needs re-link: disconnect Google and Link Google again for inbox access.");
        }
      } else {
        setMessages([]);
      }
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load AI tab");
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  async function sendChat() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy("chat");
    setError(null);
    const nextChat: ChatTurn[] = [...chat, { role: "user", content: text }];
    setChat(nextChat);
    setInput("");
    try {
      const res = await fetch("/api/wiki/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextChat }),
      });
      const json = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `Chat failed (${res.status})`);
      setChat([...nextChat, { role: "model", content: json.reply || "" }]);
      if (!saveContent && json.reply) {
        setSaveContent(json.reply);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "chat_error");
      setChat(chat);
    } finally {
      setBusy(null);
    }
  }

  async function savePage() {
    if (!saveTitle.trim() || !saveContent.trim() || busy) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch("/api/wiki/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_page",
          title: saveTitle.trim(),
          content: saveContent.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setSaveTitle("");
      setSaveContent("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_error");
    } finally {
      setBusy(null);
    }
  }

  async function scanInbox() {
    if (busy) return;
    setBusy("scan");
    setError(null);
    setScanNote(null);
    try {
      const res = await fetch("/api/gmail/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_to_todos" }),
      });
      const json = (await res.json()) as {
        added?: FamilyTodo[];
        scanned?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Scan failed (${res.status})`);
      const n = json.added?.length ?? 0;
      setScanNote(
        `Scanned ${json.scanned ?? 0} message(s); added ${n} todo(s).`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan_error");
    } finally {
      setBusy(null);
    }
  }

  async function todoAction(
    action: "complete" | "uncomplete" | "remove",
    id: string,
  ) {
    setBusy(`todo-${id}`);
    try {
      const res = await fetch("/api/todos/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-base text-slate-100">
      <div className="box-border flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
            WikiLLM
          </h1>
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
        {scanNote ? (
          <p className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200">
            {scanNote}
          </p>
        ) : null}

        <div className="board-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3 lg:overflow-hidden">
          {/* Chat */}
          <section className={`${panel} p-3 sm:p-4`}>
            <h2 className="mb-2 shrink-0 text-base font-semibold text-white">
              Chat
            </h2>
            {!status?.geminiConfigured || !status?.wikilmGithubConfigured ? (
              <p className="text-sm text-slate-400">
                Set <code className="text-slate-300">GEMINI_API_KEY</code>,{" "}
                <code className="text-slate-300">WIKILM_GITHUB_REPO</code>, and{" "}
                <code className="text-slate-300">WIKILM_GITHUB_TOKEN</code> for
                wiki-grounded answers.
              </p>
            ) : (
              <>
                <div className="board-scrollbar mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
                  {chat.length === 0 ? (
                    <p className="text-slate-500">
                      Ask about recipes or household notes from your private
                      GitHub wiki.
                    </p>
                  ) : (
                    chat.map((m, i) => (
                      <div
                        key={`${m.role}-${i}`}
                        className={`rounded-lg px-3 py-2 whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-slate-800 text-slate-100"
                            : "bg-slate-950/80 text-slate-200"
                        }`}
                      >
                        {m.content}
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="flex shrink-0 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendChat();
                  }}
                >
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-500"
                    placeholder="Ask about recipes…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={busy === "chat"}
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                    disabled={busy === "chat" || !input.trim()}
                  >
                    {busy === "chat" ? "…" : "Ask"}
                  </button>
                </form>
              </>
            )}
          </section>

          {/* Wiki save + pages */}
          <section className={`${panel} p-3 sm:p-4`}>
            <h2 className="mb-2 shrink-0 text-base font-semibold text-white">
              Wiki
            </h2>
            {!status?.wikilmGithubConfigured ? (
              <p className="text-sm text-slate-400">
                Knowledge is stored only in your private GitHub repo. Configure{" "}
                <code className="text-slate-300">WIKILM_GITHUB_REPO</code> and{" "}
                <code className="text-slate-300">WIKILM_GITHUB_TOKEN</code>.
              </p>
            ) : (
              <>
                <ul className="mb-3 max-h-28 shrink-0 space-y-1 overflow-y-auto text-sm text-slate-300">
                  {pages.length === 0 ? (
                    <li className="text-slate-500">No markdown pages yet.</li>
                  ) : (
                    pages.map((p) => (
                      <li key={p.path} className="truncate" title={p.path}>
                        {p.title}
                      </li>
                    ))
                  )}
                </ul>
                <input
                  className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-500"
                  placeholder="Page title"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  disabled={Boolean(busy)}
                />
                <textarea
                  className="mb-2 min-h-28 w-full flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-500"
                  placeholder="Markdown to save to GitHub…"
                  value={saveContent}
                  onChange={(e) => setSaveContent(e.target.value)}
                  disabled={Boolean(busy)}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  disabled={
                    busy === "save" ||
                    !saveTitle.trim() ||
                    !saveContent.trim()
                  }
                  onClick={() => void savePage()}
                >
                  {busy === "save" ? "Saving…" : "Save to wiki"}
                </button>
              </>
            )}
          </section>

          {/* Inbox + Todos */}
          <section className={`${panel} gap-4 p-3 sm:p-4 lg:col-span-2 xl:col-span-1`}>
            <div className="min-h-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-white">Inbox</h2>
                <button
                  type="button"
                  className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  disabled={
                    Boolean(busy) ||
                    !status?.gmailReady ||
                    !status?.geminiConfigured
                  }
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
                  <a
                    className="text-sky-300 underline"
                    href="/api/auth/google"
                  >
                    Link Google
                  </a>{" "}
                  to use the inbox drop-box.
                </p>
              ) : (
                <ul className="board-scrollbar max-h-40 space-y-2 overflow-y-auto text-sm sm:max-h-48">
                  {messages.length === 0 ? (
                    <li className="text-slate-500">
                      Forward actionable mail here, then Scan inbox.
                    </li>
                  ) : (
                    messages.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-slate-100">
                            {m.subject}
                          </span>
                          {m.processed ? (
                            <span className="shrink-0 text-xs text-slate-500">
                              processed
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          {m.from}
                        </div>
                        <div className="line-clamp-2 text-xs text-slate-500">
                          {m.snippet}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>

            <div className="min-h-0 flex-1 border-t border-slate-800 pt-3">
              <h2 className="mb-2 text-base font-semibold text-white">Todos</h2>
              <ul className="board-scrollbar max-h-48 space-y-2 overflow-y-auto text-sm">
                {todos.length === 0 ? (
                  <li className="text-slate-500">No todos yet.</li>
                ) : (
                  todos.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={t.done}
                        disabled={busy === `todo-${t.id}`}
                        onChange={() =>
                          void todoAction(
                            t.done ? "uncomplete" : "complete",
                            t.id,
                          )
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
                          <div className="text-xs text-slate-500">
                            Due hint: {t.dueHint}
                          </div>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
