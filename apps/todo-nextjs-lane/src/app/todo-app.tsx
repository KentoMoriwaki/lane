"use client";

import type { AppType, Todo } from "@lane/todo-api";
import { hc } from "hono/client";
import { Plus, Trash2 } from "lucide-react";
import {
  FormEvent,
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";

const apiUrl = process.env.NEXT_PUBLIC_TODO_API_URL ?? "http://localhost:4000";
const client = hc<AppType>(apiUrl);

export function TodoApp() {
  const [title, setTitle] = useState("");
  const [todosPromise, setTodosPromise] = useState<Promise<Todo[]> | null>(
    null,
  );
  const [isTransitionPending, beginTransition] = useTransition();
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    setTodosPromise(listTodos());
  }, []);

  const refresh = useCallback(() => {
    beginTransition(() => {
      setTodosPromise(listTodos());
    });
  }, [beginTransition]);

  async function mutate(operation: () => Promise<unknown>) {
    setMutationError(null);
    setIsMutating(true);

    try {
      await operation();
      refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || isMutating) {
      return;
    }

    void mutate(async () => {
      const response = await client.todos.$post({
        json: { title },
      });
      await assertOk(response);
      setTitle("");
    });
  }

  const pending = isMutating || isTransitionPending;

  return (
    <main className="app-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">Next.js / Lane path</p>
          <h1>Todos</h1>
        </div>
        <div className="status-pill">{pending ? "Transitioning" : "Idle"}</div>
      </div>

      <section className="todo-panel">
        <form className="composer" onSubmit={handleSubmit}>
          <input
            aria-label="New todo"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
          />
          <button
            className="primary-button"
            disabled={!title.trim() || isMutating}
            type="submit"
          >
            <Plus size={18} aria-hidden="true" />
            Add
          </button>
        </form>

        {mutationError ? (
          <div className="error-state">{mutationError}</div>
        ) : null}

        {todosPromise ? (
          <Suspense fallback={<div className="loading-state">Loading...</div>}>
            <TodoList
              todosPromise={todosPromise}
              pending={pending}
              onToggle={(todo) =>
                void mutate(async () => {
                  const response = await client.todos[":id"].$patch({
                    param: { id: todo.id },
                    json: { completed: !todo.completed },
                  });
                  await assertOk(response);
                })
              }
              onDelete={(id) =>
                void mutate(async () => {
                  const response = await client.todos[":id"].$delete({
                    param: { id },
                  });
                  await assertOk(response);
                })
              }
            />
          </Suspense>
        ) : (
          <div className="loading-state">Loading...</div>
        )}
      </section>
    </main>
  );
}

async function listTodos() {
  const response = await client.todos.$get();
  await assertOk(response);
  return response.json();
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }

  const fallback = `Request failed with ${response.status}`;
  const body = await response.text();

  if (!body) {
    throw new Error(fallback);
  }

  let message = body;

  try {
    const data = JSON.parse(body) as { error?: unknown };
    if (typeof data.error === "string") {
      message = data.error;
    }
  } catch {
    // Keep the raw response body for non-JSON errors.
  }

  throw new Error(message);
}

function TodoList({
  todosPromise,
  pending,
  onToggle,
  onDelete,
}: {
  todosPromise: Promise<Todo[]>;
  pending: boolean;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
}) {
  const todos = use(todosPromise);

  if (todos.length === 0) {
    return <div className="empty-state">No todos yet.</div>;
  }

  return (
    <div className="todo-list">
      {todos.map((todo) => (
        <div className="todo-row" key={todo.id}>
          <input
            aria-label={`Toggle ${todo.title}`}
            className="checkbox"
            checked={todo.completed}
            disabled={pending}
            type="checkbox"
            onChange={() => onToggle(todo)}
          />
          <span className="todo-title" data-completed={todo.completed}>
            {todo.title}
          </span>
          <button
            aria-label={`Delete ${todo.title}`}
            className="icon-button"
            disabled={pending}
            type="button"
            onClick={() => onDelete(todo.id)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
