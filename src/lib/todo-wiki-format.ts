/** Pure parse/serialize for the wiki-backed todo checklist (no I/O). */

export type FamilyTodo = {
  id: string;
  title: string;
  notes?: string;
  sourceMessageId?: string;
  dueHint?: string;
  done: boolean;
  createdAt: string;
};

export const TODOS_WIKI_PATH = "todos/list.md";

const META_RE =
  /<!--\s*fb:([^>]*)-->\s*$/;
const ITEM_RE = /^(\s*)- \[([ xX])\]\s+(.+?)\s*$/;

function parseMeta(raw: string): Partial<FamilyTodo> {
  const out: Partial<FamilyTodo> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.split("=");
    const key = k?.trim();
    const val = rest.join("=").trim();
    if (!key || !val) continue;
    if (key === "id") out.id = val;
    else if (key === "due") out.dueHint = val;
    else if (key === "notes") out.notes = val;
    else if (key === "src") out.sourceMessageId = val;
    else if (key === "created") out.createdAt = val;
  }
  return out;
}

function encodeMeta(t: FamilyTodo): string {
  const bits = [`id=${t.id}`, `created=${t.createdAt}`];
  if (t.dueHint) bits.push(`due=${t.dueHint.replace(/[;>\n]/g, " ")}`);
  if (t.notes) bits.push(`notes=${t.notes.replace(/[;>\n]/g, " ")}`);
  if (t.sourceMessageId) bits.push(`src=${t.sourceMessageId.replace(/[;>\n]/g, "")}`);
  return `<!-- fb:${bits.join(";")} -->`;
}

export function parseTodoChecklist(body: string): FamilyTodo[] {
  const todos: FamilyTodo[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const done = m[2].toLowerCase() === "x";
    let rest = m[3].trim();
    let meta: Partial<FamilyTodo> = {};
    const mm = rest.match(META_RE);
    if (mm) {
      meta = parseMeta(mm[1]);
      rest = rest.slice(0, mm.index).trim();
    }
    if (!rest) continue;
    todos.push({
      id: meta.id || `legacy-${todos.length}-${rest.slice(0, 24)}`,
      title: rest,
      notes: meta.notes,
      sourceMessageId: meta.sourceMessageId,
      dueHint: meta.dueHint,
      done,
      createdAt: meta.createdAt || new Date(0).toISOString(),
    });
  }
  return todos;
}

export function composeTodoChecklistPage(todos: FamilyTodo[], updated: string): string {
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const lines: string[] = [
    "---",
    "title: Todos",
    "summary: Family open tasks and recently finished ones",
    "tags: [todos]",
    `updated: ${updated}`,
    "---",
    "",
    "# Todos",
    "",
    "Open tasks for the family. The assistant and inbox scan keep this page up to date.",
    "",
    "## Open",
    "",
  ];
  if (!open.length) lines.push("_Nothing open._", "");
  else {
    for (const t of open) lines.push(`- [ ] ${t.title} ${encodeMeta(t)}`);
    lines.push("");
  }
  lines.push("## Done", "");
  if (!done.length) lines.push("_Nothing finished yet._", "");
  else {
    for (const t of done) lines.push(`- [x] ${t.title} ${encodeMeta(t)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function emptyTodoPage(updated: string): string {
  return composeTodoChecklistPage([], updated);
}
