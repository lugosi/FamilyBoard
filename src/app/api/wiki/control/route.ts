import { NextResponse } from "next/server";
import {
  createWikiPage,
  deleteWikiPage,
  isWikilmGithubConfigured,
  moveWikiPage,
  saveWikiPageRaw,
  wikiErrorStatus,
} from "@/lib/wikilm-github";

type ControlBody = {
  action?: "save_page" | "create_page" | "move_page" | "delete_page";
  path?: string;
  newPath?: string;
  /** Raw markdown (frontmatter included) for save_page. */
  content?: string;
  /** Version being edited; omit on save_page to create a new page. */
  sha?: string;
  category?: string;
  title?: string;
  summary?: string;
  tags?: string[] | string;
  body?: string;
};

function tagList(tags: ControlBody["tags"]): string[] | undefined {
  if (Array.isArray(tags)) return tags.filter((t) => typeof t === "string");
  if (typeof tags === "string") return tags.split(",");
  return undefined;
}

export async function POST(request: Request) {
  if (!isWikilmGithubConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set WIKILM_GITHUB_REPO and WIKILM_GITHUB_TOKEN for the private wiki",
      },
      { status: 501 },
    );
  }

  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "save_page": {
        if (!body.path?.trim() || !body.content?.trim()) {
          return NextResponse.json({ error: "path and content are required" }, { status: 400 });
        }
        const page = await saveWikiPageRaw({ path: body.path, content: body.content, sha: body.sha });
        return NextResponse.json({ page });
      }
      case "create_page": {
        if (!body.title?.trim()) {
          return NextResponse.json({ error: "title is required" }, { status: 400 });
        }
        const page = await createWikiPage({
          title: body.title,
          category: body.category,
          path: body.path,
          summary: body.summary,
          tags: tagList(body.tags),
          body: body.body,
        });
        return NextResponse.json({ page });
      }
      case "move_page": {
        if (!body.path?.trim() || !body.newPath?.trim()) {
          return NextResponse.json({ error: "path and newPath are required" }, { status: 400 });
        }
        const page = await moveWikiPage({ path: body.path, newPath: body.newPath });
        return NextResponse.json({ page });
      }
      case "delete_page": {
        if (!body.path?.trim()) {
          return NextResponse.json({ error: "path is required" }, { status: 400 });
        }
        const page = await deleteWikiPage({ path: body.path, sha: body.sha });
        return NextResponse.json({ deleted: page });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_error";
    return NextResponse.json({ error: message }, { status: wikiErrorStatus(e) });
  }
}
