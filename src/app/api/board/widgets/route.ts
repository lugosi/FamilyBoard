import { NextResponse } from "next/server";
import { normalizeBoardWidgetLayout } from "@/lib/board-widget-layout";
import {
  readBoardWidgetLayout,
  writeBoardWidgetLayout,
} from "@/lib/board-widget-layout-store";

export async function GET() {
  const layout = await readBoardWidgetLayout();
  return NextResponse.json(layout);
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const layout = await writeBoardWidgetLayout(normalizeBoardWidgetLayout(body));
  return NextResponse.json(layout);
}
