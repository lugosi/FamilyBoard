import { NextResponse } from "next/server";
import { WIKI_CATEGORIES } from "@/lib/wiki-format";
import {
  isWikilmGithubConfigured,
  listWikiPages,
  searchWiki,
  wikiErrorStatus,
} from "@/lib/wikilm-github";

export async function GET(request: Request) {
  if (!isWikilmGithubConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set WIKILM_GITHUB_REPO and WIKILM_GITHUB_TOKEN for the private wiki",
      },
      { status: 501 },
    );
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const category = url.searchParams.get("category")?.trim() || undefined;
  try {
    const categories = WIKI_CATEGORIES;
    if (q) {
      const results = await searchWiki(q, { category, limit: 25 });
      return NextResponse.json({ query: q, results, categories });
    }
    const pages = await listWikiPages({
      bypassCache: url.searchParams.get("fresh") === "1",
    });
    return NextResponse.json({ pages, categories });
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_error";
    return NextResponse.json({ error: message }, { status: wikiErrorStatus(e) });
  }
}
