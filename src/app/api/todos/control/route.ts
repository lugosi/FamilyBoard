import { NextResponse } from "next/server";
import {
  addTodo,
  removeTodo,
  setTodoDone,
} from "@/lib/todos";

type ControlBody = {
  action?: "add" | "complete" | "uncomplete" | "remove";
  id?: string;
  title?: string;
  notes?: string;
  dueHint?: string;
};

export async function POST(request: Request) {
  let body: ControlBody;
  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    if (body.action === "add") {
      if (!body.title?.trim()) {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }
      const todo = await addTodo({
        title: body.title,
        notes: body.notes,
        dueHint: body.dueHint,
      });
      return NextResponse.json({ todo });
    }
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (body.action === "complete" || body.action === "uncomplete") {
      const todo = await setTodoDone(body.id, body.action === "complete");
      if (!todo) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ todo });
    }
    if (body.action === "remove") {
      const ok = await removeTodo(body.id);
      if (!ok) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "todos_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
