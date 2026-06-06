import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type { Label, Todo, UpdateTodoInput } from "./app.js";

type TodoRow = {
  id: string;
  title: string;
  completed: 0 | 1;
  created_at: string;
  updated_at: string;
};

type LabelRow = {
  id: string;
  name: string;
  created_at: string;
};

const dbPath = resolve(process.env.TODO_DB_PATH ?? "data/todos.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  pragma foreign_keys = on;

  create table if not exists todos (
    id text primary key,
    title text not null,
    completed integer not null default 0,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists labels (
    id text primary key,
    name text not null collate nocase unique,
    created_at text not null
  );

  create table if not exists todo_labels (
    todo_id text not null,
    label_id text not null,
    created_at text not null,
    primary key (todo_id, label_id),
    foreign key (todo_id) references todos(id) on delete cascade,
    foreign key (label_id) references labels(id) on delete cascade
  );
`);

function toLabel(row: LabelRow): Label {
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
  };
}

function toTodo(row: TodoRow, labels: Label[] = []): Todo {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    labels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTodos(): Todo[] {
  const rows = db
    .prepare("select * from todos order by created_at asc")
    .all() as TodoRow[];

  return rows.map((row) => toTodo(row, listLabelsForTodo(row.id)));
}

export function createTodo(title: string): Todo {
  const now = new Date().toISOString();
  const todo: Todo = {
    id: nanoid(),
    title,
    completed: false,
    labels: [],
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

export function listLabels({
  limit,
  q,
}: {
  limit: number;
  q: string;
}): Label[] {
  const trimmedQuery = q.trim();
  const escapedQuery = escapeLike(trimmedQuery);

  const rows = trimmedQuery
    ? (db
        .prepare(
          `
            select * from labels
            where name like ? escape '\\'
            order by name asc
            limit ?
          `,
        )
        .all(`%${escapedQuery}%`, limit) as LabelRow[])
    : (db
        .prepare(
          `
            select * from labels
            order by name asc
            limit ?
          `,
        )
        .all(limit) as LabelRow[]);

  return rows.map(toLabel);
}

export function createLabel(name: string): Label {
  const trimmedName = name.trim();
  const existing = findLabelByName(trimmedName);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const label: Label = {
    createdAt: now,
    id: nanoid(),
    name: trimmedName,
  };

  db.prepare(
    `
      insert into labels (id, name, created_at)
      values (?, ?, ?)
    `,
  ).run(label.id, label.name, label.createdAt);

  return label;
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

  return toTodo(
    {
      ...current,
      title: updated.title,
      completed: updated.completed as 0 | 1,
      updated_at: updated.updatedAt,
    },
    listLabelsForTodo(id),
  );
}

export function deleteTodo(id: string): boolean {
  const result = db.prepare("delete from todos where id = ?").run(id);
  return result.changes > 0;
}

export function addLabelToTodo(todoId: string, labelId: string): Todo | null {
  if (!findTodoRow(todoId) || !findLabelById(labelId)) {
    return null;
  }

  db.prepare(
    `
      insert or ignore into todo_labels (todo_id, label_id, created_at)
      values (?, ?, ?)
    `,
  ).run(todoId, labelId, new Date().toISOString());

  return touchTodo(todoId);
}

export function removeLabelFromTodo(
  todoId: string,
  labelId: string,
): Todo | null {
  if (!findTodoRow(todoId)) {
    return null;
  }

  db.prepare("delete from todo_labels where todo_id = ? and label_id = ?").run(
    todoId,
    labelId,
  );

  return touchTodo(todoId);
}

function listLabelsForTodo(todoId: string): Label[] {
  const rows = db
    .prepare(
      `
        select labels.*
        from labels
        inner join todo_labels on todo_labels.label_id = labels.id
        where todo_labels.todo_id = ?
        order by labels.name asc
      `,
    )
    .all(todoId) as LabelRow[];

  return rows.map(toLabel);
}

function findTodoRow(id: string): TodoRow | null {
  return (
    (db.prepare("select * from todos where id = ?").get(id) as
      | TodoRow
      | undefined) ?? null
  );
}

function findLabelById(id: string): Label | null {
  const row = db
    .prepare("select * from labels where id = ?")
    .get(id) as LabelRow | undefined;

  return row ? toLabel(row) : null;
}

function findLabelByName(name: string): Label | null {
  const row = db
    .prepare("select * from labels where name = ? collate nocase")
    .get(name) as LabelRow | undefined;

  return row ? toLabel(row) : null;
}

function touchTodo(id: string): Todo | null {
  const current = findTodoRow(id);

  if (!current) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  db.prepare("update todos set updated_at = ? where id = ?").run(updatedAt, id);

  return toTodo(
    {
      ...current,
      updated_at: updatedAt,
    },
    listLabelsForTodo(id),
  );
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
