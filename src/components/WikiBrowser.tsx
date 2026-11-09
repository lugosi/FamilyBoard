"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { truncateLines, type ChatAttachment } from "@/lib/tabular";
import { splitWikiSections, type WikiSectionSlice } from "@/lib/wiki-format";

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

function toChatAttachment(name: string, summary: string, text: string): ChatAttachment {
  const cut = truncateLines(text.trim());
  return {
    name,
    kind: "text",
    summary: cut.truncated ? `${summary} · truncated` : summary,
    text: cut.text,
    truncated: cut.truncated,
  };
}

const inputClass =
  "w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-3.5 py-2.5 text-base text-white outline-none placeholder:text-slate-500 focus:border-slate-500";
const btn =
  "rounded-md border border-slate-600/80 bg-slate-800/90 px-3 py-2 text-sm font-medium text-slate-100 hover:border-slate-500 hover:bg-slate-700 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-50";
const ghostBtn =
  "rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50";

export function WikiBrowser({
  active,
  configured,
  refreshKey,
  focusPath,
  focusNonce,
  onAddToChat,
}: {
  active: boolean;
  configured: boolean;
  refreshKey: number;
  /** When set (with a changing focusNonce), open this wiki path. */
  focusPath?: string | null;
  focusNonce?: number;
  /** Attach the current page or a section to the chat composer and switch to Chat. */
  onAddToChat?: (attachment: ChatAttachment) => void;
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());
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
    setCollapsedSections(new Set());
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

  const viewBody = useMemo(() => (page ? bodyWithoutTitle(page) : ""), [page]);
  const { preamble, sections } = useMemo(() => splitWikiSections(viewBody), [viewBody]);

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

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function toggleCat(key: string) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addPageToChat() {
    if (!page || !onAddToChat) return;
    onAddToChat(
      toChatAttachment(
        page.path,
        page.summary || page.title,
        `# ${page.title}\n\n${viewBody.trim()}\n`,
      ),
    );
  }

  function addSectionToChat(section: WikiSectionSlice) {
    if (!page || !onAddToChat) return;
    onAddToChat(
      toChatAttachment(
        `${page.path}#${section.title}`,
        `${page.title} · ${section.title}`,
        section.markdown,
      ),
    );
  }

  if (!configured) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-3 px-2 py-10 text-center">
        <p className="text-lg font-medium text-slate-100">Wiki not linked yet</p>
        <p className="text-sm leading-relaxed text-slate-400">
          The family wiki lives in a private GitHub repo. Set{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">WIKILM_GITHUB_TOKEN</code>{" "}
          (fine-grained PAT with Contents read/write on{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">lugosi/family-wiki</code>)
          to browse and edit it here.
        </p>
      </div>
    );
  }

  const list: (WikiPageMeta & { snippet?: string })[] | null = results;
  const openLink = (href: string) => {
    if (page) void openPage(resolveWikiLink(page.path, href));
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Search wiki…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the wiki"
          />
          <button
            type="button"
            className={primaryBtn}
            onClick={() => {
              setMode("new");
              setError(null);
              setNotice(null);
            }}
          >
            New
          </button>
        </div>
        <div
          className="board-scrollbar max-h-64 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950/40 p-2 md:max-h-none"
          aria-label="Wiki pages"
        >
          {!pages ? (
            <p className="px-2 py-3 text-sm text-slate-500">Loading…</p>
          ) : list ? (
            list.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">No pages match “{query.trim()}”.</p>
            ) : (
              <ul className="space-y-0.5">
                {list.map((p) => (
                  <PageItem key={p.path} page={p} active={p.path === selected} onOpen={openPage} />
                ))}
              </ul>
            )
          ) : pages.length === 0 ? (
            <p className="px-2 py-3 text-sm leading-relaxed text-slate-400">
              No pages yet. Create one, or ask the assistant to remember something.
            </p>
          ) : (
            groups.map((g) => {
              const catKey = g.key || "_root";
              const catOpen = !collapsedCats.has(catKey);
              return (
                <div key={catKey} className="mb-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    aria-expanded={catOpen}
                    onClick={() => toggleCat(catKey)}
                  >
                    <Chevron open={catOpen} />
                    <WikiCategoryIcon id={g.key} className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1 truncate">{g.label}</span>
                    <span className="tabular-nums text-slate-500">{g.pages.length}</span>
                  </button>
                  {catOpen ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {g.pages.map((p) => (
                        <PageItem key={p.path} page={p} active={p.path === selected} onOpen={openPage} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {pages ? (
          <p className="px-1 text-[11px] text-slate-500 tabular-nums">
            {pages.length} page{pages.length === 1 ? "" : "s"} ·{" "}
            <button type="button" className="underline decoration-slate-600 hover:text-slate-300" onClick={() => void loadList(true)}>
              reload
            </button>
          </p>
        ) : null}
      </aside>

      <section className="relative flex min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[radial-gradient(120%_80%_at_10%_-10%,rgba(56,189,248,0.08),transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.88))] shadow-[inset_0_1px_0_rgba(148,163,184,0.06)]">
        {error ? (
          <div className="m-3 mb-0 flex items-center justify-between gap-2 rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
            <span>{error}</span>
            {conflict && page ? (
              <button type="button" className={btn} onClick={() => void openPage(page.path)}>
                Reload latest
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p className="m-3 mb-0 rounded-xl border border-emerald-900/50 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-100">
            {notice}
          </p>
        ) : null}

        {mode === "new" ? (
          <form
            className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void createPage();
            }}
          >
            <h2 className="text-xl font-semibold tracking-tight text-white">New page</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <label className="relative flex items-center gap-2">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                  <WikiCategoryIcon id={form.category} className="h-4 w-4" />
                </span>
                <select
                  className={`${inputClass} pl-9`}
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
              </label>
              <input
                className={inputClass}
                placeholder="Title, e.g. Maya or Wi-Fi"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                aria-label="Title"
                required
              />
            </div>
            <p className="text-xs text-slate-400">{categories.find((c) => c.id === form.category)?.hint}</p>
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
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            {busy === "open" ? (
              <p className="text-sm text-slate-400">Opening…</p>
            ) : (
              <>
                <p className="text-xl font-medium tracking-tight text-slate-100">Pick a page</p>
                <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                  Browse the family knowledge base, or tell the assistant “remember that…” and it files it on the right page.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <header className="sticky top-0 z-[1] flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 bg-slate-950/70 px-4 py-3 backdrop-blur-md sm:px-5">
              <div className="min-w-0">
                <p className="mb-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-slate-500">
                  <WikiCategoryIcon id={page.category} className="h-3.5 w-3.5" />
                  <span className="truncate">{page.path}</span>
                </p>
                <h2 className="truncate text-2xl font-semibold tracking-tight text-white">{page.title}</h2>
                {page.summary ? (
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-300">{page.summary}</p>
                ) : null}
                {page.tags.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {page.tags.map((t) => (
                      <li
                        key={t}
                        className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {page.updated ? (
                  <p className="mt-1.5 text-[11px] text-slate-500">Updated {page.updated}</p>
                ) : null}
              </div>
              {mode === "view" ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {onAddToChat ? (
                    <button
                      type="button"
                      className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-sm font-medium text-emerald-100 hover:border-emerald-500 hover:bg-emerald-900/50 disabled:opacity-50"
                      disabled={Boolean(busy)}
                      onClick={addPageToChat}
                    >
                      Add to chat
                    </button>
                  ) : null}
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
            </header>

            {mode === "move" ? (
              <form
                className="mx-4 mt-3 flex flex-wrap items-center gap-2 text-xs sm:mx-5"
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
              <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-100 sm:mx-5">
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
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 sm:p-5">
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
              <div className="board-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                {sections.length ? (
                  <div className="mb-3 flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className={ghostBtn}
                      onClick={() => setCollapsedSections(new Set())}
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      className={ghostBtn}
                      onClick={() =>
                        setCollapsedSections(new Set(sections.map((s) => s.title)))
                      }
                    >
                      Collapse all
                    </button>
                  </div>
                ) : null}

                {preamble.trim() ? (
                  <div className="mb-5">
                    <ChatMarkdown onRelativeLink={openLink}>{preamble}</ChatMarkdown>
                  </div>
                ) : null}

                {sections.length ? (
                  <div className="space-y-2.5">
                    {sections.map((section) => {
                      const open = !collapsedSections.has(section.title);
                      return (
                        <section
                          key={`${page.path}:${section.title}`}
                          className="overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/35"
                        >
                          <div className="flex items-stretch gap-1 border-b border-slate-800/80">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-900/50"
                              aria-expanded={open}
                              onClick={() => toggleSection(section.title)}
                            >
                              <Chevron open={open} />
                              <span className="min-w-0 flex-1 truncate text-base font-semibold text-white">
                                {section.title}
                              </span>
                            </button>
                            {onAddToChat ? (
                              <button
                                type="button"
                                className={`${ghostBtn} mr-1.5 self-center whitespace-nowrap text-emerald-200/90 hover:text-emerald-100`}
                                onClick={() => addSectionToChat(section)}
                              >
                                Add to chat
                              </button>
                            ) : null}
                          </div>
                          {open ? (
                            <div className="px-3 py-3 sm:px-4">
                              {section.body.trim() ? (
                                <ChatMarkdown onRelativeLink={openLink}>{section.body}</ChatMarkdown>
                              ) : (
                                <p className="text-sm italic text-slate-500">Empty section</p>
                              )}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : !preamble.trim() ? (
                  <p className="text-sm italic text-slate-500">This page is empty.</p>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path fill="currentColor" d="M6 3.5 11 8l-5 4.5V3.5Z" />
    </svg>
  );
}

/** Stroke icons for wiki folders — tinted so the sidebar scans quickly. */
const CATEGORY_ICON_TINT: Record<string, string> = {
  people: "text-sky-300",
  house: "text-amber-300",
  recipes: "text-orange-300",
  school: "text-indigo-300",
  health: "text-rose-300",
  travel: "text-cyan-300",
  notes: "text-slate-300",
  todos: "text-emerald-300",
  skills: "text-violet-300",
};

function WikiCategoryIcon({
  id,
  className = "h-4 w-4",
}: {
  id: string;
  className?: string;
}) {
  const tint = CATEGORY_ICON_TINT[id] ?? "text-slate-400";
  const common = `${className} shrink-0 ${tint}`;
  switch (id) {
    case "people":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" />
          <circle cx="10" cy="8" r="3.25" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 19v-.75a3.25 3.25 0 0 0-2.4-3.14" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 7.4a2.75 2.75 0 1 1 0 3.2" />
        </svg>
      );
    case "house":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4 11 8-7 8 7" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 10.5V19h11v-8.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19v-5h4v5" />
        </svg>
      );
    case "recipes":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 12v9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 3v18" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 8h2.5a1.5 1.5 0 0 1 0 3H16" />
        </svg>
      );
    case "school":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="m3 10 9-5 9 5-9 5-9-5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 12.5v4.2c0 .4.7 1.4 5 2.3 4.3-.9 5-1.9 5-2.3v-4.2" />
          <path strokeLinecap="round" d="M21 10v6" />
        </svg>
      );
    case "health":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"
          />
        </svg>
      );
    case "travel":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 12.5 4 10l1-2 6.2 1.6L16 4l2 1-2.8 6.5L22 14l-2 1-5.2-1.8L12 20l-2-1 1.8-5.2Z"
          />
        </svg>
      );
    case "notes":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V20.25H7z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 3.75V8.25H19" />
          <path strokeLinecap="round" d="M10 12h6M10 15.5h6" />
        </svg>
      );
    case "todos":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 7.5 11 9l3.5-3.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 15.5 11 17l3.5-3.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 6.5h2.5M5 14.5h2.5" />
          <path strokeLinecap="round" d="M16.5 7h3M16.5 15h3" />
        </svg>
      );
    case "skills":
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m12 3 1.2 3.6L17 8l-3.8 1.4L12 13l-1.2-3.6L7 8l3.8-1.4L12 3Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m18.5 13 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m6.2 14 .55 1.65L8.4 16.2l-1.65.55L6.2 18.4l-.55-1.65L4 16.2l1.65-.55L6.2 14Z"
          />
        </svg>
      );
    default:
      return (
        <svg aria-hidden viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5h6l1.5 1.75H20V18.5H4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5V5.75h5.25L10.5 7.5" />
        </svg>
      );
  }
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
        className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
          active
            ? "bg-sky-500/15 text-white ring-1 ring-inset ring-sky-500/40"
            : "text-slate-200 hover:bg-slate-800/70"
        }`}
      >
        <WikiCategoryIcon id={page.category} className="mt-0.5 h-3.5 w-3.5 opacity-90" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{page.title}</span>
          <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-slate-400">
            {page.snippet || page.summary || page.path}
          </span>
        </span>
      </button>
    </li>
  );
}
