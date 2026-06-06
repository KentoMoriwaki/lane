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
  changeTodoLabelsAction,
  deleteTodoAction,
  type TaskLabelMutation,
  toggleTodoAction,
  updateTodoTitleAction,
} from "./actions";
import {
  TodoLabelCombobox,
  type ChangeTaskLabelsAction,
} from "./todo-label-combobox";

type ToggleState = {
  error: string | null;
};

type DetailState = {
  error: string | null;
};

type TaskLabelState = {
  error: string | null;
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
      _previousState: ToggleState,
      requestedCompleted: boolean,
    ): Promise<ToggleState> => {
      const result = await toggleTodoAction(todo.id, requestedCompleted);

      if (!result.ok) {
        return {
          error: result.error,
        };
      }

      return {
        error: null,
      };
    },
    {
      error: null,
    },
  );
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    todo.completed,
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
      _previousState: DetailState,
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
          error: result.error,
        };
      }

      return {
        error: null,
      };
    },
    {
      error: null,
    },
  );
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    todo.completed,
    (_currentCompleted, nextCompleted: boolean) => nextCompleted,
  );
  const [
    changeTaskLabelsState,
    dispatchChangeTaskLabelsAction,
    isChangingTaskLabels,
  ] = useActionState(
    async (
      _previousState: TaskLabelState,
      mutation: TaskLabelMutation,
    ): Promise<TaskLabelState> => {
      const result = await changeTodoLabelsAction(todo.id, mutation);

      if (!result.ok) {
        return {
          error: result.error,
        };
      }

      return {
        error: null,
      };
    },
    {
      error: null,
    },
  );
  const [isDeleting, startDeleteTransition] = useTransition();
  const isDetailPending = isPending || isDeleting || isChangingTaskLabels;

  const changeTaskLabelsAction: ChangeTaskLabelsAction = async (mutation) => {
    startTransition(() => {
      dispatchChangeTaskLabelsAction(mutation);
    });
  };

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
    <div
      aria-busy={isDetailPending}
      className="details-content"
      data-pending={isDetailPending}
    >
      <div className="details-header">
        <div className="details-meta">
          <p className="eyebrow">Task detail</p>
          {isDetailPending ? (
            <span className="details-saving">Saving...</span>
          ) : null}
        </div>
        <h2 data-completed={todo.completed}>{todo.title}</h2>
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
            defaultValue={todo.title}
          />
          <button
            aria-label={`Save ${todo.title}`}
            className="icon-button"
            type="submit"
          >
            <Save size={17} aria-hidden="true" />
          </button>
        </div>
      </form>

      <TodoLabelCombobox
        assignedLabels={todo.labels}
        changeTaskLabelsAction={changeTaskLabelsAction}
      />

      {state.error ? (
        <div className="details-error">{state.error}</div>
      ) : null}
      {changeTaskLabelsState.error ? (
        <div className="details-error">{changeTaskLabelsState.error}</div>
      ) : null}

      <button
        className="danger-button"
        disabled={isDeleting}
        type="button"
        onClick={() => {
          startDeleteTransition(async () => {
            await deleteTodoAction(todo.id);
            router.replace("/");
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
