import { NextResponse } from "next/server";
import { canReadContextPath } from "@/lib/personal-context-format";
import {
  isWikilmGithubConfigured,
  readWikiPage,
  wikiErrorStatus,
} from "@/lib/wikilm-github";

export async function GET(request: Request) {
  if (!isWikilmGithubConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set WIKILM_GITHUB_TOKEN for the private wiki",
      },
      { status: 501 },
    );
  }
  const path = new URL(request.url).searchParams.get("path")?.trim();
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const page = await readWikiPage(path);
    // Personal `.context/` pages are for the Slack assistant only; the shared board never serves them.
    if (!canReadContextPath(page.path)) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }
    return NextResponse.json({ page });
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_error";
    return NextResponse.json({ error: message }, { status: wikiErrorStatus(e) });
  }
}
