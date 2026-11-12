import { getDefaultTimeZone } from "./google";
import { diagnoseContentsWrite404 } from "./wikilm-diagnose";
import {
  categoryOf,
  composeNewPage,
  composeSkillPage,
  SKILLS_FOLDER,
  slugify,
  editSection,
  existingWikiPath,
  newWikiPath,
  pathForNewPage,
  searchPages,
  toMeta,
  toWikiPage,
  withChanges,
  WikiPathError,
  type SectionEditMode,
  type WikiFrontmatter,
  type WikiPage,
  type WikiPageMeta,
  type WikiSearchResult,
} from "./wiki-format";

export { diagnoseContentsWrite404 } from "./wikilm-diagnose";

export type { WikiPage, WikiPageMeta, WikiSearchResult } from "./wiki-format";

export type WikiErrorCode =
  | "not_configured"
  | "not_found"
  | "exists"
  | "conflict"
  | "invalid"
  | "upstream";

export class WikiError extends Error {
  code: WikiErrorCode;
  constructor(code: WikiErrorCode, message: string) {
    super(message);
    this.name = "WikiError";
    this.code = code;
  }
}

export function wikiErrorStatus(e: unknown): number {
  if (e instanceof WikiPathError) return 400;
  if (!(e instanceof WikiError)) return 502;
  return {
    not_configured: 501,
    not_found: 404,
    exists: 409,
    conflict: 409,
    invalid: 400,
    upstream: 502,
  }[e.code];
}

type WikiConfig = {
  owner: string;
  repo: string;
  token: string;
  branch: string;
  basePath: string;
};

const CACHE_MS = 60_000;
const BLOB_CONCURRENCY = 6;

let pagesCache: { at: number; pages: WikiPage[] } | null = null;
let pagesLoading: Promise<WikiPage[]> | null = null;
/** Blob sha → file text; blobs are immutable so this never goes stale. */
const blobCache = new Map<string, string>();

/** Default private family wiki; override with WIKILM_GITHUB_REPO if needed. */
export const DEFAULT_WIKILM_GITHUB_REPO = "lugosi/family-wiki";

/** Seeded starter skill path (relative to wiki root). */
export const STRAVA_TRAINING_SKILL_PATH = `${SKILLS_FOLDER}/strava-training.md`;

export function getWikilmGithubConfig(): WikiConfig | null {
  const token = process.env.WIKILM_GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repoFull =
    process.env.WIKILM_GITHUB_REPO?.trim() || DEFAULT_WIKILM_GITHUB_REPO;
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) return null;
  // Empty / unset → resolved from the repo's default branch on first GitHub call.
  const branch = process.env.WIKILM_GITHUB_BRANCH?.trim() || "";
  // Empty string / "." = repo root; unset defaults to a wiki/ folder.
  const pathEnv = process.env.WIKILM_GITHUB_PATH;
  const basePath =
    pathEnv === undefined
      ? "wiki"
      : pathEnv.trim().replace(/^\/+|\/+$/g, "").replace(/^\.$/, "");
  return { owner, repo, token, branch, basePath };
}

/** Cache of owner/repo → default branch (when WIKILM_GITHUB_BRANCH is unset). */
const defaultBranchCache = new Map<string, string>();

async function withBranch(cfg: WikiConfig): Promise<WikiConfig> {
  if (cfg.branch) return cfg;
  const key = `${cfg.owner}/${cfg.repo}`;
  let branch = defaultBranchCache.get(key);
  if (!branch) {
    const meta = await gh<{ default_branch?: string; message?: string }>(
      cfg,
      "GET",
      `/repos/${cfg.owner}/${cfg.repo}`,
    );
    if (meta.status === 404) {
      throw new WikiError(
        "upstream",
        `GitHub can't see ${key}. Check WIKILM_GITHUB_TOKEN: fine-grained PAT must include that repo with Contents read/write (404 often means no access, not a missing file).`,
      );
    }
    if (meta.status !== 200) throw upstream(meta.status, meta.text);
    branch = meta.json?.default_branch?.trim() || "main";
    defaultBranchCache.set(key, branch);
  }
  return { ...cfg, branch };
}

async function explainWrite404(cfg: WikiConfig, rel: string, text: string): Promise<WikiError> {
  const full = repoPath(cfg, rel);
  const meta = await gh<{ default_branch?: string; size?: number }>(
    cfg,
    "GET",
    `/repos/${cfg.owner}/${cfg.repo}`,
  );
  return new WikiError(
    "upstream",
    diagnoseContentsWrite404({
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      fullPath: full,
      putBodyText: text,
      repoStatus: meta.status,
      repoSize: meta.json?.size,
      defaultBranch: meta.json?.default_branch,
    }),
  );
}

export function isWikilmGithubConfigured(): boolean {
  return Boolean(getWikilmGithubConfig());
}

function requireConfig(): WikiConfig {
  const cfg = getWikilmGithubConfig();
  if (!cfg) {
    throw new WikiError(
      "not_configured",
      "Set WIKILM_GITHUB_TOKEN for the private wiki (fine-grained PAT with Contents read/write on lugosi/family-wiki)",
    );
  }
  return cfg;
}

function apiBase(): string {
  return (process.env.WIKILM_GITHUB_API_BASE_URL?.trim() || "https://api.github.com").replace(
    /\/+$/,
    "",
  );
}

function todayInFamilyZone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDefaultTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function gh<T>(
  cfg: WikiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T | null; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "FamilyBoard-WikiLLM",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new WikiError("upstream", `GitHub unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text().catch(() => "");
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new WikiError("upstream", `GitHub ${res.status}: check WIKILM_GITHUB_TOKEN access to the repo`);
  }
  return { status: res.status, json, text };
}

function upstream(status: number, text: string): WikiError {
  return new WikiError("upstream", `GitHub ${status}: ${text.slice(0, 200)}`);
}

function repoPath(cfg: WikiConfig, rel: string): string {
  return [cfg.basePath, rel].filter(Boolean).join("/");
}

function contentsUrl(cfg: WikiConfig, rel: string): string {
  const full = repoPath(cfg, rel).split("/").map(encodeURIComponent).join("/");
  return `/repos/${cfg.owner}/${cfg.repo}/contents/${full}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function fetchAllPages(cfgIn: WikiConfig): Promise<WikiPage[]> {
  const cfg = await withBranch(cfgIn);
  const tree = await gh<{ tree?: { path: string; type: string; sha: string }[] }>(
    cfg,
    "GET",
    `/repos/${cfg.owner}/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`,
  );
  // 409: empty repository (no commits yet) — treat as no pages.
  if (tree.status === 409) return [];
  if (tree.status === 404) {
    // Branch missing, or token can't see the repo. Prefer a clear error over a fake empty wiki.
    const meta = await gh<{ default_branch?: string }>(
      cfg,
      "GET",
      `/repos/${cfg.owner}/${cfg.repo}`,
    );
    if (meta.status === 404) {
      throw new WikiError(
        "upstream",
        `GitHub can't see ${cfg.owner}/${cfg.repo}. Check WIKILM_GITHUB_TOKEN: fine-grained PAT must include that repo with Contents read/write.`,
      );
    }
    const def = meta.json?.default_branch;
    if (def && cfg.branch && def !== cfg.branch) {
      throw new WikiError(
        "upstream",
        `Branch “${cfg.branch}” not found (repo default is “${def}”). Set WIKILM_GITHUB_BRANCH=${def} or unset it.`,
      );
    }
    throw new WikiError(
      "upstream",
      `GitHub can't read branch “${cfg.branch}” on ${cfg.owner}/${cfg.repo}. Check WIKILM_GITHUB_BRANCH and token access.`,
    );
  }
  if (tree.status !== 200 || !tree.json) throw upstream(tree.status, tree.text);

  const prefix = cfg.basePath ? `${cfg.basePath}/` : "";
  const files = (tree.json.tree ?? []).filter(
    (e) => e.type === "blob" && /\.md$/i.test(e.path) && e.path.startsWith(prefix),
  );

  const pages = await mapLimit(files, BLOB_CONCURRENCY, async (file) => {
    let content = blobCache.get(file.sha);
    if (content === undefined) {
      const blob = await gh<{ content?: string; encoding?: string }>(
        cfg,
        "GET",
        `/repos/${cfg.owner}/${cfg.repo}/git/blobs/${file.sha}`,
      );
      if (blob.status !== 200 || !blob.json) throw upstream(blob.status, blob.text);
      content =
        blob.json.encoding === "base64"
          ? Buffer.from(blob.json.content ?? "", "base64").toString("utf8")
          : (blob.json.content ?? "");
      blobCache.set(file.sha, content);
    }
    return toWikiPage(file.path.slice(prefix.length), content, file.sha);
  });

  const live = new Set(files.map((f) => f.sha));
  for (const sha of blobCache.keys()) if (!live.has(sha)) blobCache.delete(sha);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadWikiPages(opts?: { bypassCache?: boolean }): Promise<WikiPage[]> {
  const cfg = requireConfig();
  if (!opts?.bypassCache && pagesCache && Date.now() - pagesCache.at < CACHE_MS) {
    return pagesCache.pages;
  }
  if (!pagesLoading) {
    pagesLoading = fetchAllPages(cfg)
      .then((pages) => {
        pagesCache = { at: Date.now(), pages };
        return pages;
      })
      .finally(() => {
        pagesLoading = null;
      });
  }
  return pagesLoading;
}

export async function listWikiPages(opts?: { bypassCache?: boolean }): Promise<WikiPageMeta[]> {
  return (await loadWikiPages(opts)).map(toMeta);
}

export async function searchWiki(
  query: string,
  opts?: { category?: string; limit?: number },
): Promise<WikiSearchResult[]> {
  return searchPages(await loadWikiPages(), query, opts);
}

async function fetchPage(cfgIn: WikiConfig, rel: string): Promise<WikiPage | null> {
  const cfg = await withBranch(cfgIn);
  const res = await gh<{ type?: string; content?: string; encoding?: string; sha?: string }>(
    cfg,
    "GET",
    `${contentsUrl(cfg, rel)}?ref=${encodeURIComponent(cfg.branch)}`,
  );
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.json) throw upstream(res.status, res.text);
  if (res.json.type !== "file") throw new WikiError("invalid", `${rel} is not a page`);
  const content =
    res.json.encoding === "base64"
      ? Buffer.from(res.json.content ?? "", "base64").toString("utf8")
      : (res.json.content ?? "");
  return toWikiPage(rel, content, res.json.sha);
}

/** Fresh read straight from GitHub (not the index cache); use before edits. */
export async function readWikiPage(path: string): Promise<WikiPage> {
  const cfg = requireConfig();
  const rel = existingWikiPath(path, cfg.basePath);
  const page = await fetchPage(cfg, rel);
  if (page) return page;
  // Tolerate case/extension slips from the model ("People/Maya" for "people/maya.md").
  const match = (await loadWikiPages()).find((p) => p.path.toLowerCase() === rel.toLowerCase());
  const retry = match ? await fetchPage(cfg, match.path) : null;
  if (!retry) throw new WikiError("not_found", `No wiki page at ${rel}`);
  return retry;
}

/**
 * Contents API cannot create the first file in an empty repo (404). Seed the
 * default branch with a single commit via the Git Data API instead.
 */
async function putFirstCommit(
  cfg: WikiConfig,
  rel: string,
  content: string,
  message: string,
): Promise<WikiPage> {
  const full = repoPath(cfg, rel);
  const blob = await gh<{ sha?: string }>(cfg, "POST", `/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
    content,
    encoding: "utf-8",
  });
  if (blob.status !== 201 || !blob.json?.sha) throw await explainWrite404(cfg, rel, blob.text);

  const tree = await gh<{ sha?: string }>(cfg, "POST", `/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    tree: [{ path: full, mode: "100644", type: "blob", sha: blob.json.sha }],
  });
  if (tree.status !== 201 || !tree.json?.sha) throw await explainWrite404(cfg, rel, tree.text);

  const commit = await gh<{ sha?: string }>(cfg, "POST", `/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    message,
    tree: tree.json.sha,
    parents: [],
  });
  if (commit.status !== 201 || !commit.json?.sha) throw await explainWrite404(cfg, rel, commit.text);

  const ref = await gh(cfg, "POST", `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
    ref: `refs/heads/${cfg.branch}`,
    sha: commit.json.sha,
  });
  // 422: ref already exists (race) — fall back to Contents on the next attempt.
  if (ref.status !== 201 && ref.status !== 200) throw await explainWrite404(cfg, rel, ref.text);

  // Blob sha from git/blobs is the file sha Contents would return.
  blobCache.set(blob.json.sha, content);
  pagesCache = null;
  defaultBranchCache.set(`${cfg.owner}/${cfg.repo}`, cfg.branch);
  return toWikiPage(rel, content, blob.json.sha);
}

async function repoLooksEmpty(cfg: WikiConfig): Promise<boolean> {
  const meta = await gh<{ size?: number }>(cfg, "GET", `/repos/${cfg.owner}/${cfg.repo}`);
  if (meta.status === 404) return false;
  if (meta.status === 200 && (meta.json?.size ?? 0) === 0) return true;
  const tree = await gh(
    cfg,
    "GET",
    `/repos/${cfg.owner}/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}`,
  );
  return tree.status === 409;
}

async function putFile(
  cfgIn: WikiConfig,
  rel: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<WikiPage> {
  const cfg = await withBranch(cfgIn);
  // Empty repos: skip Contents (always 404) and create the first commit directly.
  if (!sha && (await repoLooksEmpty(cfg))) {
    return putFirstCommit(cfg, rel, content, message);
  }
  const res = await gh<{ content?: { sha?: string } }>(cfg, "PUT", contentsUrl(cfg, rel), {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  });
  if (res.status === 409 || (res.status === 422 && sha)) {
    throw new WikiError("conflict", `${rel} changed since it was read; reload and try again`);
  }
  if (res.status === 422) throw new WikiError("exists", `A page already exists at ${rel}`);
  if (res.status === 404) {
    // Race: repo became empty, or Contents refused while Git Data still works for empty seed.
    if (!sha && (await repoLooksEmpty(cfg))) {
      return putFirstCommit(cfg, rel, content, message);
    }
    throw await explainWrite404(cfg, rel, res.text);
  }
  if ((res.status !== 200 && res.status !== 201) || !res.json) throw upstream(res.status, res.text);
  const newSha = res.json.content?.sha;
  if (newSha) blobCache.set(newSha, content);
  pagesCache = null;
  return toWikiPage(rel, content, newSha);
}

async function deleteFile(cfgIn: WikiConfig, rel: string, sha: string, message: string): Promise<void> {
  const cfg = await withBranch(cfgIn);
  const res = await gh(cfg, "DELETE", contentsUrl(cfg, rel), {
    message,
    sha,
    branch: cfg.branch,
  });
  if (res.status === 404) throw new WikiError("not_found", `No wiki page at ${rel}`);
  if (res.status === 409 || res.status === 422) {
    throw new WikiError("conflict", `${rel} changed since it was read; reload and try again`);
  }
  if (res.status !== 200) throw upstream(res.status, res.text);
  pagesCache = null;
}

export async function createWikiPage(input: {
  title: string;
  category?: string;
  path?: string;
  summary?: string;
  tags?: string[];
  body?: string;
}): Promise<WikiPage> {
  const cfg = requireConfig();
  const title = input.title?.trim();
  if (!title) throw new WikiError("invalid", "A page title is required");
  const rel = input.path?.trim()
    ? newWikiPath(input.path, cfg.basePath)
    : pathForNewPage(input.category, title);
  const squash = (s: string) => slugify(s).replace(/-/g, "");
  const folder = categoryOf(rel);
  const twin = (await loadWikiPages()).find(
    (p) =>
      p.category === folder &&
      (squash(p.title) === squash(title) ||
        squash(p.path.split("/").pop()!.replace(/\.md$/i, "")) === squash(title)),
  );
  if (twin) {
    throw new WikiError("exists", `“${twin.title}” already exists at ${twin.path}; add to that page instead`);
  }
  const content = composeNewPage({
    title,
    summary: input.summary,
    tags: input.tags,
    body: input.body,
    updated: todayInFamilyZone(),
  });
  return putFile(cfg, rel, content, undefined, `wiki: add ${rel}`);
}

/** Server-side section edit on the latest version; retries once if the page moved underneath. */
export async function editWikiSection(input: {
  path: string;
  section?: string;
  text: string;
  mode: SectionEditMode;
}): Promise<{ page: WikiPage; created: boolean; heading: string | null }> {
  const cfg = requireConfig();
  for (let attempt = 0; ; attempt++) {
    const page = await readWikiPage(input.path);
    let edit: ReturnType<typeof editSection>;
    try {
      edit = editSection(page.body, input.section, input.text, input.mode);
    } catch (e) {
      throw new WikiError("invalid", e instanceof Error ? e.message : String(e));
    }
    const content = withChanges(page.content, { body: edit.body, updated: todayInFamilyZone() });
    try {
      const saved = await putFile(
        cfg,
        page.path,
        content,
        page.sha,
        `wiki: ${input.mode === "replace" ? "update" : "add to"} ${edit.heading ?? "end of"} in ${page.path}`,
      );
      return { page: saved, created: edit.created, heading: edit.heading };
    } catch (e) {
      if (attempt === 0 && e instanceof WikiError && e.code === "conflict") continue;
      throw e;
    }
  }
}

/** Replace a page's body and/or metadata; refuses if it changed since `expectedSha`. */
export async function rewriteWikiPage(input: {
  path: string;
  expectedSha: string;
  body?: string;
  meta?: WikiFrontmatter;
}): Promise<WikiPage> {
  const cfg = requireConfig();
  const page = await readWikiPage(input.path);
  if (page.sha !== input.expectedSha) {
    throw new WikiError("conflict", `${page.path} changed since it was read; read it again first`);
  }
  const content = withChanges(page.content, {
    body: input.body,
    meta: input.meta,
    updated: todayInFamilyZone(),
  });
  return putFile(cfg, page.path, content, page.sha, `wiki: rewrite ${page.path}`);
}

/** Raw save from the editor: create when `sha` is absent, otherwise update that version. */
export async function saveWikiPageRaw(input: {
  path: string;
  content: string;
  sha?: string;
}): Promise<WikiPage> {
  const cfg = requireConfig();
  if (!input.content.trim()) throw new WikiError("invalid", "Page content is empty");
  const rel = input.sha
    ? existingWikiPath(input.path, cfg.basePath)
    : newWikiPath(input.path, cfg.basePath);
  const content = withChanges(input.content, { updated: todayInFamilyZone() });
  return putFile(cfg, rel, content, input.sha, `wiki: ${input.sha ? "edit" : "add"} ${rel}`);
}

/**
 * Create a skill (or any wiki page) only if it does not already exist.
 * Used to seed starter skills without clobbering family edits.
 */
export async function ensureWikiSkillIfMissing(input: {
  path: string;
  content: string;
  commitMessage?: string;
}): Promise<{ status: "created" | "exists"; path: string; page?: WikiPage }> {
  const cfg = requireConfig();
  const rel = newWikiPath(input.path, cfg.basePath);
  const existing = await fetchPage(cfg, rel);
  if (existing) return { status: "exists", path: rel, page: existing };
  const content = withChanges(input.content, { updated: todayInFamilyZone() });
  const page = await putFile(
    cfg,
    rel,
    content,
    undefined,
    input.commitMessage ?? `wiki: add ${rel}`,
  );
  return { status: "created", path: rel, page };
}

/** Save a reusable skill page under skills/; replacing an existing skill must be explicit. */
export async function saveSkill(input: {
  name: string;
  whenToUse: string;
  inputs?: string;
  steps: string[];
  notes?: string;
  tags?: string[];
  replaceExisting?: boolean;
}): Promise<{ page: WikiPage; replaced: boolean }> {
  const cfg = requireConfig();
  let content: string;
  try {
    content = composeSkillPage({ ...input, updated: todayInFamilyZone() });
  } catch (e) {
    throw new WikiError("invalid", e instanceof Error ? e.message : String(e));
  }
  const squash = (s: string) => slugify(s).replace(/-/g, "");
  const twin = (await loadWikiPages()).find(
    (p) =>
      p.category === SKILLS_FOLDER &&
      (squash(p.title) === squash(input.name) ||
        squash(p.path.split("/").pop()!.replace(/\.md$/i, "")) === squash(input.name)),
  );
  const rel = twin?.path ?? pathForNewPage(SKILLS_FOLDER, input.name);
  const existing = await fetchPage(cfg, rel);
  if (existing && !input.replaceExisting) {
    throw new WikiError(
      "exists",
      `A skill named “${existing.title}” already exists (${rel}). Ask whether to replace it, then call save_skill with replaceExisting.`,
    );
  }
  const page = await putFile(
    cfg,
    rel,
    content,
    existing?.sha,
    `skill: ${existing ? "update" : "add"} ${rel}`,
  );
  return { page, replaced: Boolean(existing) };
}

export async function moveWikiPage(input: { path: string; newPath: string }): Promise<WikiPage> {
  const cfg = requireConfig();
  const page = await readWikiPage(input.path);
  const target = newWikiPath(input.newPath, cfg.basePath);
  if (target === page.path) return page;
  const moved = await putFile(cfg, target, page.content, undefined, `wiki: move ${page.path} → ${target}`);
  await deleteFile(cfg, page.path, page.sha!, `wiki: move ${page.path} → ${target}`);
  return moved;
}

export async function deleteWikiPage(input: { path: string; sha?: string }): Promise<WikiPageMeta> {
  const cfg = requireConfig();
  const page = await readWikiPage(input.path);
  if (input.sha && input.sha !== page.sha) {
    throw new WikiError("conflict", `${page.path} changed since it was read; reload and try again`);
  }
  await deleteFile(cfg, page.path, page.sha!, `wiki: delete ${page.path}`);
  return toMeta(page);
}
