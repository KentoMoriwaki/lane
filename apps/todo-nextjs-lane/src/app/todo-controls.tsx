"use client";

import type { Todo } from "@lane/todo-api";
import {
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  startTransition,
  useActionState,
  useOptimistic,
  useRef,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import {
  deleteTodoAction,
  toggleTodoAction,
  updateTodoTitleAction,
} from "./actions";

type ToggleState = {
  completed: boolean;
  error: string | null;
};

type DetailState = {
  completed: boolean;
  error: string | null;
  title: string;
};

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

  return (
    <button
      aria-label="Refresh todos"
      className="icon-button"
      type="button"
      onClick={() => {
        router.refresh();
      }}
    >
      <RefreshCw size={17} aria-hidden="true" />
    </button>
  );
}

export function TodoRow({
  disabled,
  isSelected,
  todo,
}: {
  disabled?: boolean;
  isSelected?: boolean;
  todo: Todo;
}) {
  const router = useRouter();
  const [state, dispatchToggle, isPending] = useActionState(
    async (
      previousState: ToggleState,
      requestedCompleted: boolean,
    ): Promise<ToggleState> => {
      const result = await toggleTodoAction(todo.id, requestedCompleted);

      if (!result.ok) {
        return {
          completed: previousState.completed,
          error: result.error,
        };
      }

      router.refresh();

      return {
        completed: result.todo.completed,
        error: null,
      };
    },
    {
      completed: todo.completed,
      error: null,
    },
  );
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    state.completed,
    (_currentCompleted, nextCompleted: boolean) => nextCompleted,
  );

  return (
    <div
      className="todo-row"
      data-pending={isPending}
      data-selected={isSelected}
    >
      <span className="toggle-form">
        <input
          aria-label={`Toggle ${todo.title}`}
          aria-busy={isPending}
          className="checkbox"
          checked={optimisticCompleted}
          disabled={disabled}
          type="checkbox"
          onChange={() => {
            const nextCompleted = !optimisticCompleted;

            startTransition(() => {
              setOptimisticCompleted(nextCompleted);
              dispatchToggle(nextCompleted);
            });
          }}
        />
      </span>
      <button
        className="todo-title-button"
        data-completed={optimisticCompleted}
        disabled={disabled}
        type="button"
        onClick={() => {
          router.push(`/?todoId=${encodeURIComponent(todo.id)}`);
        }}
      >
        {todo.title}
      </button>
      <button
        aria-label={`Open ${todo.title} details`}
        className="icon-button"
        disabled={disabled}
        type="button"
        onClick={() => {
          router.push(`/?todoId=${encodeURIComponent(todo.id)}`);
        }}
      >
        <PanelRightOpen size={17} aria-hidden="true" />
      </button>
      <TodoDeleteForm todo={todo} disabled={disabled} />
      {state.error ? (
        <span className="todo-row-error">{state.error}</span>
      ) : null}
    </div>
  );
}

export function TodoDetailControls({
  todo,
}: {
  todo: Todo;
}) {
  const router = useRouter();
  const [state, dispatchDetail, isPending] = useActionState(
    async (
      previousState: DetailState,
      mutation:
        | { type: "completed"; completed: boolean }
        | { type: "title"; title: string },
    ): Promise<DetailState> => {
      const result =
        mutation.type === "completed"
          ? await toggleTodoAction(todo.id, mutation.completed)
          : await updateTodoTitleAction(todo.id, mutation.title);

      if (!result.ok) {
        return {
          ...previousState,
          error: result.error,
        };
      }

      router.refresh();

      return {
        completed: result.todo.completed,
        error: null,
        title: result.todo.title,
      };
    },
    {
      completed: todo.completed,
      error: null,
      title: todo.title,
    },
  );
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    state.completed,
    (_currentCompleted, nextCompleted: boolean) => nextCompleted,
  );
  const [isDeleting, startDeleteTransition] = useTransition();

  function submitTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextTitle = formData.get("title");

    startTransition(() => {
      dispatchDetail({
        title: typeof nextTitle === "string" ? nextTitle : "",
        type: "title",
      });
    });
  }

  return (
    <div className="details-content" data-pending={isPending}>
      <div className="details-header">
        <p className="eyebrow">Task detail</p>
        <h2 data-completed={optimisticCompleted}>{state.title}</h2>
      </div>

      <label className="details-check">
        <input
          aria-busy={isPending}
          className="checkbox"
          checked={optimisticCompleted}
          type="checkbox"
          onChange={() => {
            const nextCompleted = !optimisticCompleted;

            startTransition(() => {
              setOptimisticCompleted(nextCompleted);
              dispatchDetail({
                completed: nextCompleted,
                type: "completed",
              });
            });
          }}
        />
        <span>Completed</span>
      </label>

      <form className="details-title-form" onSubmit={submitTitle}>
        <label htmlFor={`todo-title-${todo.id}`}>Title</label>
        <div className="details-title-controls">
          <input
            id={`todo-title-${todo.id}`}
            name="title"
            defaultValue={state.title}
          />
          <button
            aria-label={`Save ${state.title}`}
            className="icon-button"
            disabled={isPending}
            type="submit"
          >
            <Save size={17} aria-hidden="true" />
          </button>
        </div>
      </form>

      {state.error ? (
        <div className="details-error">{state.error}</div>
      ) : null}

      <button
        className="danger-button"
        disabled={isDeleting}
        type="button"
        onClick={() => {
          startDeleteTransition(async () => {
            await deleteTodoAction(todo.id);
            router.replace("/");
            router.refresh();
          });
        }}
      >
        <Trash2 size={17} aria-hidden="true" />
        Delete
      </button>
    </div>
  );
}

export function TodoDeleteForm({
  disabled,
  todo,
}: {
  disabled?: boolean;
  todo: Todo;
}) {
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
