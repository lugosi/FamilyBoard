import { NextResponse } from "next/server";
import {
  deleteChatSession,
  getChatSession,
  saveChatSession,
  type StoredChatTurn,
} from "@/lib/agent-chat-sessions";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await getChatSession(id);
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { turns?: StoredChatTurn[]; title?: string };
  try {
    body = (await request.json()) as { turns?: StoredChatTurn[]; title?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.turns !== undefined && !Array.isArray(body.turns)) {
    return NextResponse.json({ error: "turns must be an array" }, { status: 400 });
  }
  const session = await saveChatSession(id, {
    turns: body.turns,
    title: typeof body.title === "string" ? body.title : undefined,
  });
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deleteChatSession(id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
