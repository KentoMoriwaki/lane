"use client";

import type { AppType, Todo } from "@lane/todo-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hc } from "hono/client";
import { Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_TODO_API_URL ?? "http://localhost:4000";
const client = hc<AppType>(apiUrl);
const todosKey = ["todos"] as const;

export function TodoApp() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  const todosQuery = useQuery({
    queryKey: todosKey,
    queryFn: listTodos,
  });

  const invalidateTodos = () =>
    queryClient.invalidateQueries({ queryKey: todosKey });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await client.todos.$post({
        json: { title },
      });
      await assertOk(response);
    },
    onSuccess: () => {
      setTitle("");
      return invalidateTodos();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (todo: Todo) => {
      const response = await client.todos[":id"].$patch({
        param: { id: todo.id },
        json: { completed: !todo.completed },
      });
      await assertOk(response);
    },
    onSuccess: invalidateTodos,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await client.todos[":id"].$delete({
        param: { id },
      });
      await assertOk(response);
    },
    onSuccess: invalidateTodos,
  });

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || createMutation.isPending) {
      return;
    }

    createMutation.mutate();
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">Next.js / React Query</p>
          <h1>Todos</h1>
        </div>
        <div className="status-pill">
          {todosQuery.isFetching || isMutating ? "Syncing" : "Idle"}
        </div>
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
            disabled={!title.trim() || createMutation.isPending}
            type="submit"
          >
            <Plus size={18} aria-hidden="true" />
            Add
          </button>
        </form>

        {todosQuery.isLoading ? (
          <div className="loading-state">Loading...</div>
        ) : todosQuery.isError ? (
          <div className="error-state">{todosQuery.error.message}</div>
        ) : (
          <TodoList
            todos={todosQuery.data ?? []}
            pending={isMutating}
            onToggle={(todo) => updateMutation.mutate(todo)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
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
  todos,
  pending,
  onToggle,
  onDelete,
}: {
  todos: Todo[];
  pending: boolean;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
}) {
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
