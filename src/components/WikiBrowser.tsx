"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";

type WikiCategory = { id: string; label: string; hint: string };

type WikiPageMeta = {
  path: string;
  title: string;
  summary: string;
  tags: string[];
  updated?: string;
  category: string;
  sha?: string;
  size: number;
};

type WikiPage = WikiPageMeta & { content: string; body: string; headings: string[] };

type WikiSearchResult = WikiPageMeta & { snippet: string };

type Mode = "view" | "edit" | "move" | "delete" | "new";

async function wikiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("application/json")
    ? ((await res.json()) as T & { error?: string })
    : ({ error: `Unexpected response (${res.status})` } as T & { error?: string });
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}

function control<T>(body: Record<string, unknown>): Promise<T> {
  return wikiFetch<T>("/api/wiki/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Resolve a markdown link relative to the current page's folder. */
function resolveWikiLink(fromPath: string, href: string): string {
  const clean = decodeURIComponent(href.split(/[?#]/)[0]);
  const segs = clean.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const part of clean.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  const joined = segs.join("/");
  return /\.md$/i.test(joined) ? joined : `${joined}.md`;
}

/** The page header already shows the title, so drop a leading `# Title` that repeats it. */
function bodyWithoutTitle(page: WikiPage): string {
  const body = page.body.replace(/^\s+/, "");
  const m = body.match(/^#\s+(.+)\n?/);
  if (m && m[1].trim().toLowerCase() === page.title.trim().toLowerCase()) {
    return body.slice(m[0].length);
  }
  return body;
}

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base text-white outline-none focus:border-slate-500";
const btn =
  "rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const primaryBtn =
  "rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-50";

export function WikiBrowser({
  active,
  configured,
  refreshKey,
  focusPath,
  focusNonce,
}: {
  active: boolean;
  configured: boolean;
  refreshKey: number;
  /** When set (with a changing focusNonce), open this wiki path. */
  focusPath?: string | null;
  focusNonce?: number;
}) {
  const [pages, setPages] = useState<WikiPageMeta[] | null>(null);
  const [categories, setCategories] = useState<WikiCategory[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiSearchResult[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState("");
  const [movePath, setMovePath] = useState("");
  const [form, setForm] = useState({ category: "notes", title: "", summary: "", tags: "", body: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const lastFocusNonceRef = useRef<number | undefined>(undefined);

  const loadList = useCallback(async (fresh = false) => {
    try {
      const json = await wikiFetch<{ pages: WikiPageMeta[]; categories: WikiCategory[] }>(
        `/api/wiki/pages${fresh ? "?fresh=1" : ""}`,
      );
      setPages(json.pages);
      setCategories(json.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the wiki");
    }
  }, []);

  const openPage = useCallback(async (path: string) => {
    selectedRef.current = path;
    setSelected(path);
    setMode("view");
    setError(null);
    setConflict(false);
    setNotice(null);
    setBusy("open");
    try {
      const json = await wikiFetch<{ page: WikiPage }>(`/api/wiki/page?path=${encodeURIComponent(path)}`);
      if (selectedRef.current !== path) return;
      setPage(json.page);
      selectedRef.current = json.page.path;
      setSelected(json.page.path);
    } catch (e) {
      if (selectedRef.current !== path) return;
      setPage(null);
      setError(e instanceof Error ? e.message : "Could not open the page");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!active || !configured) return;
    const t = window.setTimeout(() => {
      void loadList(refreshKey > 0);
      if (refreshKey > 0 && selectedRef.current) void openPage(selectedRef.current);
    }, 0);
    return () => window.clearTimeout(t);
  }, [active, configured, refreshKey, loadList, openPage]);

  useEffect(() => {
    if (!active || !configured || !focusPath) return;
    if (focusNonce !== undefined && lastFocusNonceRef.current === focusNonce) return;
    lastFocusNonceRef.current = focusNonce;
    void openPage(focusPath);
  }, [active, configured, focusPath, focusNonce, openPage]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      const t = window.setTimeout(() => setResults(null), 0);
      return () => window.clearTimeout(t);
    }
    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const json = await wikiFetch<{ results: WikiSearchResult[] }>(
          `/api/wiki/pages?q=${encodeURIComponent(q)}`,
          { signal: ac.signal },
        );
        setResults(json.results);
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Search failed");
      }
    }, 250);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [query]);

  const groups = useMemo(() => {
    if (!pages) return [];
    const order = categories.map((c) => c.id);
    const byCat = new Map<string, WikiPageMeta[]>();
    for (const p of pages) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
    const keys = [...byCat.keys()].sort((a, b) => {
      const ia = a ? (order.includes(a) ? order.indexOf(a) : order.length) : order.length + 1;
      const ib = b ? (order.includes(b) ? order.indexOf(b) : order.length) : order.length + 1;
      return ia - ib || a.localeCompare(b);
    });
    return keys.map((key) => ({
      key,
      label: key ? (categories.find((c) => c.id === key)?.label ?? key) : "Unfiled",
      pages: (byCat.get(key) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }, [pages, categories]);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    setConflict(false);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setConflict(status === 409 && key === "save");
      setError(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!page) return;
    const json = await run("save", () =>
      control<{ page: WikiPage }>({ action: "save_page", path: page.path, sha: page.sha, content: draft }),
    );
    if (!json) return;
    setPage(json.page);
    setMode("view");
    setNotice("Saved.");
    void loadList();
  }

  async function movePage() {
    if (!page) return;
    const json = await run("move", () =>
      control<{ page: WikiPage }>({ action: "move_page", path: page.path, newPath: movePath }),
    );
    if (!json) return;
    await loadList();
    await openPage(json.page.path);
    setNotice(`Moved to ${json.page.path}.`);
  }

  async function deletePage() {
    if (!page) return;
    const json = await run("delete", () =>
      control<{ deleted: WikiPageMeta }>({ action: "delete_page", path: page.path, sha: page.sha }),
    );
    if (!json) return;
    selectedRef.current = null;
    setSelected(null);
    setPage(null);
    setMode("view");
    setNotice(`Deleted “${json.deleted.title}”. It stays in the repo's git history.`);
    void loadList();
  }

  async function createPage() {
    const json = await run("create", () =>
      control<{ page: WikiPage }>({ action: "create_page", ...form }),
    );
    if (!json) return;
    setForm({ category: form.category, title: "", summary: "", tags: "", body: "" });
    await loadList();
    await openPage(json.page.path);
    setNotice("Page created.");
  }

  if (!configured) {
    return (
      <div className="text-sm text-slate-400">
        <p>
          The family wiki lives in a private GitHub repo. Set{" "}
          <code className="text-slate-300">WIKILM_GITHUB_TOKEN</code> (fine-grained PAT with
          Contents read/write on <code className="text-slate-300">lugosi/family-wiki</code>) to
          browse and edit it here.
        </p>
      </div>
    );
  }

  const list: (WikiPageMeta & { snippet?: string })[] | null = results;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Search the wiki…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the wiki"
          />
          <button
            type="button"
            className={btn}
            onClick={() => {
              setMode("new");
              setError(null);
              setNotice(null);
            }}
          >
            New
          </button>
        </div>
        <div className="board-scrollbar max-h-64 min-h-0 flex-1 overflow-y-auto pr-1 md:max-h-none" aria-label="Wiki pages">
          {!pages ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : list ? (
            list.length === 0 ? (
              <p className="text-xs text-slate-500">No pages match “{query.trim()}”.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((p) => (
                  <PageItem key={p.path} page={p} active={p.path === selected} onOpen={openPage} />
                ))}
              </ul>
            )
          ) : pages.length === 0 ? (
            <p className="text-xs text-slate-500">
              No pages yet. Create one, or ask the assistant to remember something.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.key || "_root"} className="mb-2">
                <h3 className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <span>{g.label}</span>
                  <span className="tabular-nums">{g.pages.length}</span>
                </h3>
                <ul className="space-y-1">
                  {g.pages.map((p) => (
                    <PageItem key={p.path} page={p} active={p.path === selected} onOpen={openPage} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        {pages ? (
          <p className="text-[11px] text-slate-500 tabular-nums">
            {pages.length} page{pages.length === 1 ? "" : "s"} ·{" "}
            <button type="button" className="underline hover:text-slate-300" onClick={() => void loadList(true)}>
              reload
            </button>
          </p>
        ) : null}
      </div>

      <div className="flex min-h-[18rem] min-w-0 flex-col rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        {error ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
            <span>{error}</span>
            {conflict && page ? (
              <button type="button" className={btn} onClick={() => void openPage(page.path)}>
                Reload latest
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p className="mb-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-200">
            {notice}
          </p>
        ) : null}

        {mode === "new" ? (
          <form
            className="flex min-h-0 flex-1 flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createPage();
            }}
          >
            <h2 className="text-base font-semibold text-white">New page</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <select
                className={inputClass}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                aria-label="Folder"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="Title, e.g. Maya or Wi-Fi"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                aria-label="Title"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {categories.find((c) => c.id === form.category)?.hint}
            </p>
            <input
              className={inputClass}
              placeholder="One-line summary (helps the assistant find it)"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              aria-label="Summary"
            />
            <input
              className={inputClass}
              placeholder="Tags, comma separated"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              aria-label="Tags"
            />
            <textarea
              className={`${inputClass} board-scrollbar min-h-40 flex-1 font-mono text-xs leading-relaxed`}
              placeholder={"## Section\n\n- Detail"}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              aria-label="Page body (markdown)"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setMode("view")}>
                Cancel
              </button>
              <button type="submit" className={primaryBtn} disabled={Boolean(busy) || !form.title.trim()}>
                {busy === "create" ? "Creating…" : "Create page"}
              </button>
            </div>
          </form>
        ) : !page ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-slate-400">
            {busy === "open" ? (
              <p>Opening…</p>
            ) : (
              <>
                <p>Pick a page to read or edit.</p>
                <p className="text-xs text-slate-500">
                  Or tell the assistant “remember that…” and it files it on the right page.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-white">{page.title}</h2>
                <p className="text-xs text-slate-500">
                  {page.path}
                  {page.updated ? ` · updated ${page.updated}` : ""}
                </p>
                {page.tags.length ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {page.tags.map((t) => (
                      <li key={t} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {mode === "view" ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    className={btn}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setDraft(page.content);
                      setMode("edit");
                      setNotice(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setMovePath(page.path);
                      setMode("move");
                      setNotice(null);
                    }}
                  >
                    Move
                  </button>
                  <button
                    type="button"
                    className={`${btn} hover:border-red-700 hover:bg-red-950/60`}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setMode("delete");
                      setNotice(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>

            {mode === "move" ? (
              <form
                className="mb-2 flex flex-wrap items-center gap-2 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  void movePage();
                }}
              >
                <label className="text-slate-400" htmlFor="wiki-move-path">
                  New path
                </label>
                <input
                  id="wiki-move-path"
                  className={`${inputClass} min-w-0 flex-1 py-1.5`}
                  value={movePath}
                  onChange={(e) => setMovePath(e.target.value)}
                />
                <button type="submit" className={primaryBtn} disabled={Boolean(busy) || !movePath.trim()}>
                  {busy === "move" ? "Moving…" : "Move"}
                </button>
                <button type="button" className={btn} onClick={() => setMode("view")}>
                  Cancel
                </button>
              </form>
            ) : null}

            {mode === "delete" ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-100">
                <span className="flex-1">Delete “{page.title}”? It stays in the repo&apos;s git history.</span>
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => void deletePage()}
                >
                  {busy === "delete" ? "Deleting…" : "Delete page"}
                </button>
                <button type="button" className={btn} onClick={() => setMode("view")}>
                  Cancel
                </button>
              </div>
            ) : null}

            {mode === "edit" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <textarea
                  className={`${inputClass} board-scrollbar min-h-64 flex-1 font-mono text-xs leading-relaxed`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Page markdown"
                  spellCheck
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    Markdown with optional frontmatter (title, summary, tags).
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={btn} onClick={() => setMode("view")}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={Boolean(busy) || !draft.trim() || draft === page.content}
                      onClick={() => void saveEdit()}
                    >
                      {busy === "save" ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="board-scrollbar min-h-0 flex-1 overflow-y-auto text-sm text-slate-200">
                {page.summary ? <p className="mb-2 text-xs italic text-slate-400">{page.summary}</p> : null}
                <ChatMarkdown onRelativeLink={(href) => void openPage(resolveWikiLink(page.path, href))}>
                  {bodyWithoutTitle(page)}
                </ChatMarkdown>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PageItem({
  page,
  active,
  onOpen,
}: {
  page: WikiPageMeta & { snippet?: string };
  active: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(page.path)}
        className={`w-full rounded-lg border px-2.5 py-1.5 text-left ${
          active
            ? "border-sky-700/70 bg-sky-950/40"
            : "border-transparent hover:border-slate-700 hover:bg-slate-900"
        }`}
      >
        <div className="truncate text-sm font-medium text-slate-100">{page.title}</div>
        <div className="line-clamp-2 text-xs text-slate-400">{page.snippet || page.summary || page.path}</div>
      </button>
    </li>
  );
}
