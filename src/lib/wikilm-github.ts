export type WikiPageMeta = {
  path: string;
  title: string;
  sha?: string;
};

export type WikiPage = WikiPageMeta & {
  content: string;
};

type CacheEntry = {
  at: number;
  pages: WikiPage[];
};

let wikiCache: CacheEntry | null = null;
const CACHE_MS = 60_000;
const MAX_CONTEXT_CHARS = 80_000;

export function getWikilmGithubConfig(): {
  owner: string;
  repo: string;
  token: string;
  branch: string;
  basePath: string;
} | null {
  const repoFull = process.env.WIKILM_GITHUB_REPO?.trim();
  const token = process.env.WIKILM_GITHUB_TOKEN?.trim();
  if (!repoFull || !token) return null;
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) return null;
  const branch = process.env.WIKILM_GITHUB_BRANCH?.trim() || "main";
  const basePath = (process.env.WIKILM_GITHUB_PATH?.trim() || "wiki").replace(
    /^\/+|\/+$/g,
    "",
  );
  return { owner, repo, token, branch, basePath };
}

export function isWikilmGithubConfigured(): boolean {
  return Boolean(getWikilmGithubConfig());
}

function titleFromPath(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
}

function apiHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "FamilyBoard-WikiLLM",
  };
}

async function ghJson<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...apiHeaders(token),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type GhContentItem = {
  type: string;
  path: string;
  name: string;
  sha?: string;
  download_url?: string | null;
  content?: string;
  encoding?: string;
};

async function listMarkdownFiles(
  owner: string,
  repo: string,
  token: string,
  branch: string,
  dirPath: string,
): Promise<GhContentItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(dirPath).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  let data: GhContentItem | GhContentItem[];
  try {
    data = await ghJson(url, token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) return [];
    throw e;
  }
  const items = Array.isArray(data) ? data : [data];
  const out: GhContentItem[] = [];
  for (const item of items) {
    if (item.type === "file" && /\.md$/i.test(item.name)) {
      out.push(item);
    } else if (item.type === "dir") {
      const nested = await listMarkdownFiles(
        owner,
        repo,
        token,
        branch,
        item.path,
      );
      out.push(...nested);
    }
  }
  return out;
}

export async function listWikiPages(opts?: {
  bypassCache?: boolean;
}): Promise<WikiPageMeta[]> {
  const pages = await loadWikiPages(opts);
  return pages.map(({ path, title, sha }) => ({ path, title, sha }));
}

export async function loadWikiPages(opts?: {
  bypassCache?: boolean;
}): Promise<WikiPage[]> {
  const cfg = getWikilmGithubConfig();
  if (!cfg) throw new Error("wikilm_github_not_configured");

  if (
    !opts?.bypassCache &&
    wikiCache &&
    Date.now() - wikiCache.at < CACHE_MS
  ) {
    return wikiCache.pages;
  }

  const files = await listMarkdownFiles(
    cfg.owner,
    cfg.repo,
    cfg.token,
    cfg.branch,
    cfg.basePath,
  );

  const pages: WikiPage[] = [];
  for (const file of files) {
    let content = "";
    if (file.download_url) {
      const res = await fetch(file.download_url, {
        headers: apiHeaders(cfg.token),
      });
      if (!res.ok) continue;
      content = await res.text();
    } else if (file.content && file.encoding === "base64") {
      content = Buffer.from(file.content, "base64").toString("utf8");
    }
    pages.push({
      path: file.path,
      title: titleFromPath(file.path),
      sha: file.sha,
      content,
    });
  }

  wikiCache = { at: Date.now(), pages };
  return pages;
}

export function buildWikiContext(pages: WikiPage[], budget = MAX_CONTEXT_CHARS): string {
  const chunks: string[] = [];
  let used = 0;
  for (const page of pages) {
    const block = `### ${page.title} (${page.path})\n${page.content.trim()}\n`;
    if (used + block.length > budget) {
      const remaining = budget - used;
      if (remaining > 200) chunks.push(block.slice(0, remaining) + "\n…");
      break;
    }
    chunks.push(block);
    used += block.length;
  }
  return chunks.join("\n");
}

export function slugifyTitle(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "note"
  );
}

export async function commitWikiPage(input: {
  title: string;
  content: string;
  path?: string;
  message?: string;
}): Promise<WikiPageMeta> {
  const cfg = getWikilmGithubConfig();
  if (!cfg) throw new Error("wikilm_github_not_configured");

  const relative =
    input.path?.replace(/^\/+/, "") ||
    `${cfg.basePath}/${slugifyTitle(input.title)}.md`;
  const filePath = relative.startsWith(cfg.basePath)
    ? relative
    : `${cfg.basePath}/${relative}`;

  const getUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(cfg.branch)}`;

  let sha: string | undefined;
  try {
    const existing = await ghJson<GhContentItem>(getUrl, cfg.token);
    sha = existing.sha;
  } catch {
    /* create new */
  }

  const body = {
    message:
      input.message?.trim() ||
      (sha ? `Update ${filePath}` : `Add ${filePath}`),
    content: Buffer.from(input.content, "utf8").toString("base64"),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  };

  const putUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const result = await ghJson<{ content?: { path?: string; sha?: string } }>(
    putUrl,
    cfg.token,
    { method: "PUT", body: JSON.stringify(body) },
  );

  wikiCache = null;
  return {
    path: result.content?.path ?? filePath,
    title: input.title,
    sha: result.content?.sha,
  };
}
