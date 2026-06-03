"use client";

import type { Todo } from "@lane/todo-api";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useOptimistic,
  useRef,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import {
  deleteTodoAction,
  toggleTodoAction,
} from "./actions";

export function AddTodoForm({
  action,
  error,
}: {
  action: (formData: FormData) => Promise<boolean>;
  error: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={formRef}
        className="composer"
        action={async (formData) => {
          const created = await action(formData);

          if (created) {
            formRef.current?.reset();
          }
        }}
      >
        <input aria-label="New todo" name="title" placeholder="Add a task" />
        <SubmitButton />
      </form>
      {error ? <div className="error-state">{error}</div> : null}
    </>
  );
}

export function RefreshTodosForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label="Refresh todos"
      className="icon-button"
      disabled={isPending}
      type="button"
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      <RefreshCw size={17} aria-hidden="true" />
    </button>
  );
}

export function TodoToggleForm({
  disabled,
  todo,
}: {
  disabled?: boolean;
  todo: Todo;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    todo.completed,
    (_currentCompleted, nextCompleted: boolean) => nextCompleted,
  );

  return (
    <span className="toggle-form">
      <input
        aria-label={`Toggle ${todo.title}`}
        className="checkbox"
        checked={optimisticCompleted}
        disabled={disabled || isPending}
        type="checkbox"
        onChange={() => {
          const nextCompleted = !optimisticCompleted;

          startTransition(async () => {
            setOptimisticCompleted(nextCompleted);
            await toggleTodoAction(todo.id, nextCompleted);
          });
        }}
      />
    </span>
  );
}

export function TodoDeleteForm({
  disabled,
  todo,
}: {
  disabled?: boolean;
  todo: Todo;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label={`Delete ${todo.title}`}
      className="icon-button"
      disabled={disabled || isPending}
      type="button"
      onClick={() => {
        startTransition(async () => {
          await deleteTodoAction(todo.id);
        });
      }}
    >
      <Trash2 size={17} aria-hidden="true" />
    </button>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" disabled={pending} type="submit">
      <Plus size={18} aria-hidden="true" />
      {pending ? "Adding" : "Add"}
    </button>
  );
}
