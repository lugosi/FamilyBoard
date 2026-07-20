import { NextResponse } from "next/server";
import {
  isWikilmGithubConfigured,
  listWikiPages,
} from "@/lib/wikilm-github";

export async function GET() {
  if (!isWikilmGithubConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set WIKILM_GITHUB_REPO and WIKILM_GITHUB_TOKEN for the private wiki",
      },
      { status: 501 },
    );
  }
  try {
    const pages = await listWikiPages();
    return NextResponse.json({ pages });
  } catch (e) {
    const message = e instanceof Error ? e.message : "wiki_error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
