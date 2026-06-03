import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type { Todo, UpdateTodoInput } from "./app.js";

type TodoRow = {
  id: string;
  title: string;
  completed: 0 | 1;
  created_at: string;
  updated_at: string;
};

const dbPath = resolve(process.env.TODO_DB_PATH ?? "data/todos.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  create table if not exists todos (
    id text primary key,
    title text not null,
    completed integer not null default 0,
    created_at text not null,
    updated_at text not null
  );
`);

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTodos(): Todo[] {
  const rows = db
    .prepare("select * from todos order by created_at asc")
    .all() as TodoRow[];

  return rows.map(toTodo);
}

export function createTodo(title: string): Todo {
  const now = new Date().toISOString();
  const todo: Todo = {
    id: nanoid(),
    title,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `
      insert into todos (id, title, completed, created_at, updated_at)
      values (?, ?, ?, ?, ?)
    `,
  ).run(todo.id, todo.title, 0, todo.createdAt, todo.updatedAt);

  return todo;
}

export function updateTodo(id: string, input: UpdateTodoInput): Todo | null {
  const current = db
    .prepare("select * from todos where id = ?")
    .get(id) as TodoRow | undefined;

  if (!current) {
    return null;
  }

  const updated = {
    title: input.title ?? current.title,
    completed:
      input.completed === undefined ? current.completed : input.completed ? 1 : 0,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `
      update todos
      set title = ?, completed = ?, updated_at = ?
      where id = ?
    `,
  ).run(updated.title, updated.completed, updated.updatedAt, id);

  return toTodo({
    ...current,
    title: updated.title,
    completed: updated.completed as 0 | 1,
    updated_at: updated.updatedAt,
  });
}

export function deleteTodo(id: string): boolean {
  const result = db.prepare("delete from todos where id = ?").run(id);
  return result.changes > 0;
}
