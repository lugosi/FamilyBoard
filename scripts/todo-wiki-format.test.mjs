// node --test scripts/todo-wiki-format.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeTodoChecklistPage,
  parseTodoChecklist,
} from "../src/lib/todo-wiki-format.ts";

test("round-trips checklist items with metadata", () => {
  const todos = [
    {
      id: "a1",
      title: "Pay field trip fee",
      dueHint: "Friday",
      notes: "via portal",
      done: false,
      createdAt: "2026-11-08T12:00:00.000Z",
    },
    {
      id: "b2",
      title: "Call dentist",
      done: true,
      createdAt: "2026-11-01T12:00:00.000Z",
    },
  ];
  const md = composeTodoChecklistPage(todos, "2026-11-08");
  const body = md.replace(/^---[\s\S]*?---\n/, "");
  const items = parseTodoChecklist(body);
  assert.equal(items.length, 2);
  const open = items.find((t) => t.id === "a1");
  const done = items.find((t) => t.id === "b2");
  assert.ok(open);
  assert.equal(open.title, "Pay field trip fee");
  assert.equal(open.dueHint, "Friday");
  assert.equal(open.notes, "via portal");
  assert.equal(open.done, false);
  assert.ok(done);
  assert.equal(done.done, true);
});

test("round-trips shopping items with url as markdown link", () => {
  const todos = [
    {
      id: "s1",
      title: "AirPods Pro",
      url: "https://www.amazon.com/s?k=AirPods%20Pro",
      done: false,
      createdAt: "2026-11-22T12:00:00.000Z",
    },
  ];
  const md = composeTodoChecklistPage(todos, "2026-11-22");
  assert.match(md, /\[AirPods Pro\]\(https:\/\/www\.amazon\.com\/s\?k=AirPods%20Pro\)/);
  assert.match(md, /url=https:\/\/www\.amazon\.com\/s\?k=AirPods%20Pro/);
  const body = md.replace(/^---[\s\S]*?---\n/, "");
  const items = parseTodoChecklist(body);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "AirPods Pro");
  assert.equal(items[0].url, "https://www.amazon.com/s?k=AirPods%20Pro");
});
