import { NextResponse } from "next/server";
import {
  createChatSession,
  listChatSessions,
} from "@/lib/agent-chat-sessions";

export async function GET() {
  const sessions = await listChatSessions();
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  let title = "New chat";
  try {
    const body = (await request.json()) as { title?: string };
    if (typeof body.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 80);
    }
  } catch {
    /* empty body is fine */
  }
  const session = await createChatSession(title);
  return NextResponse.json({ session });
}
