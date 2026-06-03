"use client";

import type { Todo } from "@lane/todo-api";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import useSWR from "swr";
import {
  createTodo,
  deleteTodo,
  listTodos,
  todosKey,
  updateTodo,
} from "./todo-api";

export function TodoApp() {
  const [title, setTitle] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const {
    data: todos = [],
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<Todo[]>(todosKey, listTodos);

  const pending = isMutating || isValidating;
  const getCachedTodos = (currentTodos: Todo[] | undefined) =>
    Array.isArray(currentTodos) ? currentTodos : todos;

  async function runMutation(operation: () => Promise<unknown>) {
    setMutationError(null);
    setIsMutating(true);

    try {
      await operation();
    } catch (mutationError) {
      setMutationError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError),
      );
    } finally {
      setIsMutating(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle || isMutating) {
      return;
    }

    const now = new Date().toISOString();
    const optimisticTodo: Todo = {
      completed: false,
      createdAt: now,
      id: `optimistic-${crypto.randomUUID()}`,
      title: trimmedTitle,
      updatedAt: now,
    };

    void runMutation(async () => {
      await mutate(
        async (currentTodos) => {
          const cachedTodos = getCachedTodos(currentTodos);
          const createdTodo = await createTodo({ title: trimmedTitle });
          setTitle("");
          return [...cachedTodos, createdTodo];
        },
        {
          optimisticData: (currentTodos) => [
            ...getCachedTodos(currentTodos),
            optimisticTodo,
          ],
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
    });
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">Next.js / SWR</p>
          <h1>Todos</h1>
        </div>
        <div className="topbar-actions">
          <button
            aria-label="Refresh todos"
            className="icon-button"
            disabled={pending}
            type="button"
            onClick={() => void mutate()}
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
          <div className="status-pill">{pending ? "Syncing" : "Idle"}</div>
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

        {isLoading ? (
          <div className="loading-state">Loading...</div>
        ) : error ? (
          <div className="error-state">{error.message}</div>
        ) : (
          <TodoList
            todos={todos}
            pending={pending}
            onToggle={(todo) =>
              void runMutation(async () => {
                await mutate(
                  async (currentTodos) => {
                    const updatedTodo = await updateTodo(todo.id, {
                      completed: !todo.completed,
                    });
                    return replaceTodo(
                      getCachedTodos(currentTodos),
                      updatedTodo,
                    );
                  },
                  {
                    optimisticData: (currentTodos) =>
                      getCachedTodos(currentTodos).map((currentTodo) =>
                        currentTodo.id === todo.id
                          ? {
                              ...currentTodo,
                              completed: !todo.completed,
                              updatedAt: new Date().toISOString(),
                            }
                          : currentTodo,
                      ),
                    populateCache: true,
                    revalidate: false,
                    rollbackOnError: true,
                  },
                );
              })
            }
            onDelete={(todo) =>
              void runMutation(async () => {
                await mutate(
                  async (currentTodos) => {
                    await deleteTodo(todo.id);
                    return getCachedTodos(currentTodos).filter(
                      (currentTodo) => currentTodo.id !== todo.id,
                    );
                  },
                  {
                    optimisticData: (currentTodos) =>
                      getCachedTodos(currentTodos).filter(
                        (currentTodo) => currentTodo.id !== todo.id,
                      ),
                    populateCache: true,
                    revalidate: false,
                    rollbackOnError: true,
                  },
                );
              })
            }
          />
        )}
      </section>
    </main>
  );
}

function replaceTodo(todos: Todo[], todo: Todo) {
  return todos.map((currentTodo) =>
    currentTodo.id === todo.id ? todo : currentTodo,
  );
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
  onDelete: (todo: Todo) => void;
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
            disabled={pending || todo.id.startsWith("optimistic-")}
            type="checkbox"
            onChange={() => onToggle(todo)}
          />
          <span className="todo-title" data-completed={todo.completed}>
            {todo.title}
          </span>
          <button
            aria-label={`Delete ${todo.title}`}
            className="icon-button"
            disabled={pending || todo.id.startsWith("optimistic-")}
            type="button"
            onClick={() => onDelete(todo)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
