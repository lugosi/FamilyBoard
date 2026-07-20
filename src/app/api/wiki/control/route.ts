import { NextResponse } from "next/server";
import {
  commitWikiPage,
  isWikilmGithubConfigured,
} from "@/lib/wikilm-github";

type ControlBody = {
  action?: "save_page";
  title?: string;
  content?: string;
  path?: string;
  message?: string;
};

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
  if (body.action !== "save_page") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json(
      { error: "title and content are required" },
      { status: 400 },
    );
  }

  try {
    const page = await commitWikiPage({
      title: body.title,
      content: body.content,
      path: body.path,
      message: body.message,
    });
    return NextResponse.json({ page });
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_save_error";
    const status = message.includes("not_configured") ? 501 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
