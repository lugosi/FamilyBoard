import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./data-dir";

const TODOS_FILE = "todos.json";

export type FamilyTodo = {
  id: string;
  title: string;
  notes?: string;
  sourceMessageId?: string;
  dueHint?: string;
  done: boolean;
  createdAt: string;
};

type TodosFile = {
  todos: FamilyTodo[];
};

async function readFile(): Promise<TodosFile> {
  const file = path.join(getDataDir(), TODOS_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as TodosFile;
    return { todos: Array.isArray(parsed.todos) ? parsed.todos : [] };
  } catch {
    return { todos: [] };
  }
}

async function writeFile(data: TodosFile): Promise<void> {
  const file = path.join(getDataDir(), TODOS_FILE);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function listTodos(): Promise<FamilyTodo[]> {
  const data = await readFile();
  return data.todos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addTodo(input: {
  title: string;
  notes?: string;
  sourceMessageId?: string;
  dueHint?: string;
}): Promise<FamilyTodo> {
  const data = await readFile();
  const todo: FamilyTodo = {
    id: randomUUID(),
    title: input.title.trim(),
    notes: input.notes?.trim() || undefined,
    sourceMessageId: input.sourceMessageId,
    dueHint: input.dueHint?.trim() || undefined,
    done: false,
    createdAt: new Date().toISOString(),
  };
  data.todos.push(todo);
  await writeFile(data);
  return todo;
}

export async function addTodos(
  items: {
    title: string;
    notes?: string;
    sourceMessageId?: string;
    dueHint?: string;
  }[],
): Promise<FamilyTodo[]> {
  const added: FamilyTodo[] = [];
  for (const item of items) {
    if (!item.title?.trim()) continue;
    added.push(await addTodo(item));
  }
  return added;
}

export async function setTodoDone(
  id: string,
  done: boolean,
): Promise<FamilyTodo | null> {
  const data = await readFile();
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.done = done;
  await writeFile(data);
  return todo;
}

export async function removeTodo(id: string): Promise<boolean> {
  const data = await readFile();
  const next = data.todos.filter((t) => t.id !== id);
  if (next.length === data.todos.length) return false;
  await writeFile({ todos: next });
  return true;
}
