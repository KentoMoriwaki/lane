"use client";

import type { Todo } from "@lane/todo-api";
import { useOptimistic, useState } from "react";
import { createTodoAction, type TodoActionState } from "./actions";
import {
  AddTodoForm,
  RefreshTodosForm,
  TodoDeleteForm,
  TodoToggleForm,
} from "./todo-controls";

type OptimisticTodoInput = {
  id: string;
  title: string;
};

const initialCreateState: TodoActionState = {
  error: null,
  submissionId: 0,
};

export function TodoApp({ todos }: { todos: Todo[] }) {
  const [createError, setCreateError] = useState<string | null>(null);
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (currentTodos, input: OptimisticTodoInput): Todo[] => {
      const now = new Date().toISOString();

      return [
        ...currentTodos,
        {
          completed: false,
          createdAt: now,
          id: input.id,
          title: input.title,
          updatedAt: now,
        },
      ];
    },
  );

  async function createTodo(formData: FormData) {
    const title = readTitle(formData);

    if (!title) {
      setCreateError("Title is required");
      return false;
    }

    setCreateError(null);
    addOptimisticTodo({
      id: `optimistic-${crypto.randomUUID()}`,
      title,
    });

    const nextState = await createTodoAction(initialCreateState, formData);

    if (nextState.error) {
      setCreateError(nextState.error);
      return false;
    }

    return true;
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">Next.js / Lane path</p>
          <h1>Todos</h1>
        </div>
        <div className="topbar-actions">
          <RefreshTodosForm />
          <div className="status-pill">Server rendered</div>
        </div>
      </div>

      <section className="todo-panel">
        <AddTodoForm action={createTodo} error={createError} />
        <TodoList todos={optimisticTodos} />
      </section>
    </main>
  );
}

function TodoList({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) {
    return <div className="empty-state">No todos yet.</div>;
  }

  return (
    <div className="todo-list">
      {todos.map((todo) => (
        <div className="todo-row" key={todo.id}>
          <TodoToggleForm todo={todo} disabled={isOptimisticTodo(todo)} />
          <span className="todo-title" data-completed={todo.completed}>
            {todo.title}
          </span>
          <TodoDeleteForm todo={todo} disabled={isOptimisticTodo(todo)} />
        </div>
      ))}
    </div>
  );
}

function readTitle(formData: FormData) {
  const value = formData.get("title");
  return typeof value === "string" ? value.trim() : "";
}

function isOptimisticTodo(todo: Todo) {
  return todo.id.startsWith("optimistic-");
}
