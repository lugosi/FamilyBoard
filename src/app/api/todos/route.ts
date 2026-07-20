import { NextResponse } from "next/server";
import { listTodos } from "@/lib/todos";

export async function GET() {
  try {
    const todos = await listTodos();
    return NextResponse.json({ todos });
  } catch (e) {
    const message = e instanceof Error ? e.message : "todos_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
