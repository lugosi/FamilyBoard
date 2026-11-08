import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./data-dir";
import { getDefaultTimeZone } from "./google";
import {
  composeTodoChecklistPage,
  emptyTodoPage,
  parseTodoChecklist,
  TODOS_WIKI_PATH,
  type FamilyTodo,
} from "./todo-wiki-format";
import { isWikilmGithubConfigured, readWikiPage, saveWikiPageRaw, WikiError } from "./wikilm-github";
import { parseFrontmatter } from "./wiki-format";

export type { FamilyTodo } from "./todo-wiki-format";
export { TODOS_WIKI_PATH } from "./todo-wiki-format";

const TODOS_FILE = "todos.json";

type TodosFile = {
  todos: FamilyTodo[];
};

function todayStamp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDefaultTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readJsonFile(): Promise<TodosFile> {
  const file = path.join(getDataDir(), TODOS_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as TodosFile;
    return { todos: Array.isArray(parsed.todos) ? parsed.todos : [] };
  } catch {
    return { todos: [] };
  }
}

async function writeJsonFile(data: TodosFile): Promise<void> {
  const file = path.join(getDataDir(), TODOS_FILE);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

async function loadWikiTodos(): Promise<{ todos: FamilyTodo[]; sha?: string; existed: boolean }> {
  try {
    const page = await readWikiPage(TODOS_WIKI_PATH);
    const { body } = parseFrontmatter(page.content);
    return { todos: parseTodoChecklist(body), sha: page.sha, existed: true };
  } catch (e) {
    if (e instanceof WikiError && e.code === "not_found") {
      return { todos: [], existed: false };
    }
    throw e;
  }
}

async function saveWikiTodos(todos: FamilyTodo[], sha?: string): Promise<void> {
  const content = composeTodoChecklistPage(todos, todayStamp());
  await saveWikiPageRaw({ path: TODOS_WIKI_PATH, content, sha });
}

/** Prefer the wiki checklist when GitHub wiki is configured; else local JSON. */
async function wikiBackendEnabled(): Promise<boolean> {
  return isWikilmGithubConfigured();
}

async function ensureWikiSeeded(): Promise<{ todos: FamilyTodo[]; sha?: string }> {
  const loaded = await loadWikiTodos();
  if (loaded.existed) return { todos: loaded.todos, sha: loaded.sha };

  // First time: migrate any leftover local JSON into the wiki page.
  const legacy = await readJsonFile();
  const seed = legacy.todos;
  const content = seed.length
    ? composeTodoChecklistPage(seed, todayStamp())
    : emptyTodoPage(todayStamp());
  const saved = await saveWikiPageRaw({ path: TODOS_WIKI_PATH, content });
  if (seed.length) await writeJsonFile({ todos: [] });
  return { todos: seed, sha: saved.sha };
}

export async function listTodos(): Promise<FamilyTodo[]> {
  if (await wikiBackendEnabled()) {
    const { todos } = await ensureWikiSeeded();
    return [...todos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const data = await readJsonFile();
  return data.todos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addTodo(input: {
  title: string;
  notes?: string;
  sourceMessageId?: string;
  dueHint?: string;
}): Promise<FamilyTodo> {
  const todo: FamilyTodo = {
    id: randomUUID(),
    title: input.title.trim(),
    notes: input.notes?.trim() || undefined,
    sourceMessageId: input.sourceMessageId,
    dueHint: input.dueHint?.trim() || undefined,
    done: false,
    createdAt: new Date().toISOString(),
  };

  if (await wikiBackendEnabled()) {
    const { todos, sha } = await ensureWikiSeeded();
    todos.push(todo);
    await saveWikiTodos(todos, sha);
    return todo;
  }

  const data = await readJsonFile();
  data.todos.push(todo);
  await writeJsonFile(data);
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
  const cleaned = items.filter((i) => i.title?.trim());
  if (!cleaned.length) return [];

  if (await wikiBackendEnabled()) {
    const { todos, sha } = await ensureWikiSeeded();
    const added: FamilyTodo[] = [];
    for (const item of cleaned) {
      const todo: FamilyTodo = {
        id: randomUUID(),
        title: item.title.trim(),
        notes: item.notes?.trim() || undefined,
        sourceMessageId: item.sourceMessageId,
        dueHint: item.dueHint?.trim() || undefined,
        done: false,
        createdAt: new Date().toISOString(),
      };
      todos.push(todo);
      added.push(todo);
    }
    await saveWikiTodos(todos, sha);
    return added;
  }

  const added: FamilyTodo[] = [];
  for (const item of cleaned) added.push(await addTodo(item));
  return added;
}

export async function setTodoDone(
  id: string,
  done: boolean,
): Promise<FamilyTodo | null> {
  if (await wikiBackendEnabled()) {
    const { todos, sha } = await ensureWikiSeeded();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    todo.done = done;
    await saveWikiTodos(todos, sha);
    return todo;
  }

  const data = await readJsonFile();
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.done = done;
  await writeJsonFile(data);
  return todo;
}

export async function removeTodo(id: string): Promise<boolean> {
  if (await wikiBackendEnabled()) {
    const { todos, sha } = await ensureWikiSeeded();
    const next = todos.filter((t) => t.id !== id);
    if (next.length === todos.length) return false;
    await saveWikiTodos(next, sha);
    return true;
  }

  const data = await readJsonFile();
  const next = data.todos.filter((t) => t.id !== id);
  if (next.length === data.todos.length) return false;
  await writeJsonFile({ todos: next });
  return true;
}
