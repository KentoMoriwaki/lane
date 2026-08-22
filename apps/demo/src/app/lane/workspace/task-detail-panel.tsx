"use client";

import type {
  Task,
  TeamLabel,
  TeamMember,
  UpdateTaskInput,
} from "@/server/api";
import type { ProjectRef } from "@/app/lane/api/route-reads";
import { ArrowLeft, Check, FileQuestion, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { TaskSurface } from "@/app/lane/regions";
import {
  useAddTaskLabel,
  useDeleteTask,
  useMembers,
  useProjects,
  useRemoveTaskLabel,
  useTask,
  useUpdateTask,
} from "@/app/lane/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DetailSkeleton } from "./skeletons";
import { Textarea } from "@/components/ui/textarea";
import { accent } from "@/lib/accent";
import { formatRelative, toDateInputValue, fromDateInputValue } from "@/lib/format";
import { STATUS_META } from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { EmptyState, InlineSpinner, SectionError } from "./feedback";
import { LaneErrorBoundary } from "./lane-error-boundary";
import { LabelChip } from "./task-bits";
import { LabelPicker } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { ProjectPicker } from "./project-picker";
import { StatusControl } from "./status-control";
import { useWorkspaceUrl } from "./use-workspace-url";

/**
 * **One detail, two shells.**
 *
 * `/lane/task/<id>` is a route now, and it renders one of two ways. Clicked
 * from a row it is intercepted into the `@modal` slot and drawn here as the
 * panel beside the list (`TaskDetailPanel`); opened directly, reloaded, or
 * shared it renders as the full page (`TaskDetailPage`). Both are published by
 * the same region and read the same `task(id)` key through the same `useTask`.
 *
 * The `surface` they pass down is not decoration. It answers one question —
 * *is the list on screen beside this?* — and that decides how an edit here
 * converges (`api/hooks.ts`):
 *
 * - **panel**: the list is right there, so the confirmed task is `set` and the
 *   row it owns is patched **in place**, at the index it already occupies.
 * - **page**: no list is visible, so every list entry the lane holds is marked
 *   stale instead. Nothing is read until a list is looked at again.
 */

export function TaskDetailPanel({ taskId }: { taskId: string }) {
  const router = useRouter();
  // The panel was pushed onto the history by the link that opened it, so
  // "close" is the same gesture the Back button makes — which is what a user
  // expects of something that opened over what they were looking at.
  const onClose = React.useCallback(() => router.back(), [router]);

  return (
    <DetailPanelShell>
      <React.Suspense key={taskId} fallback={<DetailSkeleton />}>
        <TaskDetail taskId={taskId} surface="panel" onClose={onClose} />
      </React.Suspense>
    </DetailPanelShell>
  );
}

export function TaskDetailPage({ taskId }: { taskId: string }) {
  return (
    <DetailPageShell>
      <React.Suspense key={taskId} fallback={<DetailSkeleton />}>
        <TaskDetail taskId={taskId} surface="page" />
      </React.Suspense>
    </DetailPageShell>
  );
}

/** The read found nothing. Same message, drawn in whichever shell asked. */
export function TaskMissingPanel() {
  return (
    <DetailPanelShell>
      <EmptyState
        icon={FileQuestion}
        title="Task not found"
        message="It may have been deleted since this link was made."
        className="h-full"
      />
    </DetailPanelShell>
  );
}

export function TaskMissingPage() {
  return (
    <DetailPageShell>
      <EmptyState
        icon={FileQuestion}
        title="Task not found"
        message="It may have been deleted since this link was made."
      />
    </DetailPageShell>
  );
}

/**
 * The retry boundary the frame used to hold for the detail column. It moved
 * with the detail: the panel is a sibling of the frame now, not a slot in it,
 * and the page is a route of its own — so each route wraps its own.
 */
export function TaskDetailBoundary({
  surface,
  children,
}: {
  surface: TaskSurface;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const Shell = surface === "panel" ? DetailPanelShell : DetailPageShell;

  return (
    <LaneErrorBoundary
      resetKey={surface}
      fallback={(error, retryBoundary) => (
        <Shell>
          <div className="p-4">
            <SectionError
              title="Couldn't load this task"
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => {
                // Ask the owner to render this route again, then let the
                // boundary re-render into whatever the publication carries.
                router.refresh();
                retryBoundary();
              }}
            />
          </div>
        </Shell>
      )}
    >
      {children}
    </LaneErrorBoundary>
  );
}

function DetailPanelShell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      data-testid="task-panel"
      className="scrollbar-calm hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface lg:block"
    >
      {children}
    </aside>
  );
}

function DetailPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="task-page"
      className="scrollbar-calm min-w-0 flex-1 overflow-y-auto bg-background"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <BackToList />
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The way back, as a link rather than `router.back()`: this page is what a
 * shared URL or a reload lands on, and those have no history to go back to. It
 * carries the filters and the team along, so returning restores the view.
 */
function BackToList() {
  const { listHref } = useWorkspaceUrl();

  return (
    <Link
      href={listHref}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back to tasks
    </Link>
  );
}

function TaskDetail({
  taskId,
  surface,
  onClose,
}: {
  taskId: string;
  surface: TaskSurface;
  onClose?: () => void;
}) {
  const task = React.use(useTask(taskId).promise).data;
  const projects = React.use(useProjects().promise).data;
  const members = React.use(useMembers().promise).data;
  const { closeTask } = useWorkspaceUrl();
  const update = useUpdateTask(taskId, surface);
  const addLabel = useAddTaskLabel(taskId, surface);
  const removeLabel = useRemoveTaskLabel(taskId, surface);
  const remove = useDeleteTask(surface);
  const [isSavedVisible, showSavedNotice] = useSavedNotice();
  const [optimisticTask, addOptimisticTask] = React.useOptimistic(
    task,
    (current, change: OptimisticTaskChange) =>
      applyOptimisticTaskChange(current, change, { members, projects }),
  );
  const [, dispatchSaveAction, isSaving] = React.useActionState(
    async (version: number, action: SaveAction): Promise<number> => {
      try {
        await action.run();
        action.onSuccess?.();
      } catch (error) {
        toast.error(action.errorMessage, {
          description: error instanceof Error ? error.message : undefined,
        });
      }

      return version + 1;
    },
    0,
  );

  const isClosed = STATUS_META[optimisticTask.status].group === "closed";

  function saveTitleAction(title: string) {
    const input = { title };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't save title",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function saveDescriptionAction(description: string) {
    const input = { description };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't save description",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function changeStatusAction(status: Task["status"]) {
    const input = { status };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't update status",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function changePriorityAction(priority: Task["priority"]) {
    const input = { priority };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't update priority",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function changeAssigneeAction(assigneeId: string | null) {
    const input = { assigneeId };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't update assignee",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function changeProjectAction(projectId: string | null) {
    const input = { projectId };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't move task",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function changeDueDateAction(dueDate: string | null) {
    const input = { dueDate };
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage: "Couldn't update due date",
        onSuccess: showSavedNotice,
        run: () => update(input),
      });
    });
  }

  function addLabelAction(label: TeamLabel) {
    React.startTransition(() => {
      addOptimisticTask({ type: "addLabel", label });
      dispatchSaveAction({
        errorMessage: "Couldn't add label",
        onSuccess: showSavedNotice,
        run: () => addLabel(label),
      });
    });
  }

  function removeLabelAction(labelId: string) {
    React.startTransition(() => {
      addOptimisticTask({ type: "removeLabel", labelId });
      dispatchSaveAction({
        errorMessage: "Couldn't remove label",
        onSuccess: showSavedNotice,
        run: () => removeLabel(labelId),
      });
    });
  }

  const handleDelete = () => {
    React.startTransition(() => {
      dispatchSaveAction({
        errorMessage: "Couldn't delete task",
        run: () => remove(task.id),
        onSuccess: () => {
          toast.success("Task deleted");
          // Not `back()`: the URL that just stopped existing must not be left
          // in the history for a forward button to return to. `replace` puts
          // the list in its place — and from the page, where there may be no
          // history at all, it is the only way back.
          closeTask();
        },
      });
    });
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {optimisticTask.project ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  accent(optimisticTask.project.color).dot,
                )}
              />
              {optimisticTask.project.name}
            </span>
          ) : (
            <span>No project</span>
          )}
          {isSaving ? (
            <span className="inline-flex items-center gap-1 text-cobalt">
              <InlineSpinner className="size-3" /> Saving…
            </span>
          ) : isSavedVisible ? (
            <span className="inline-flex items-center gap-1 text-sage">
              <Check className="size-3" /> Saved
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            aria-label="Delete task"
            className="text-muted-foreground hover:text-rose"
          >
            <Trash2 className="size-4" />
          </Button>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close panel"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 p-4">
        <TitleEditor
          key={`title:${optimisticTask.id}`}
          value={optimisticTask.title}
          isClosed={isClosed}
          saveAction={saveTitleAction}
        />

        <DescriptionEditor
          key={`desc:${optimisticTask.id}`}
          value={optimisticTask.description}
          saveAction={saveDescriptionAction}
        />

        <Separator />

        <div className="space-y-3">
          <Field label="Status">
            <StatusControl
              value={optimisticTask.status}
              changeAction={changeStatusAction}
              pending={isSaving}
            />
          </Field>

          <Field label="Priority">
            <PriorityControl
              value={optimisticTask.priority}
              changeAction={changePriorityAction}
              pending={isSaving}
            />
          </Field>

          <Field label="Assignee">
            <AssigneePicker
              value={optimisticTask.assignee?.id ?? null}
              changeAction={changeAssigneeAction}
              pending={isSaving}
            />
          </Field>

          <Field label="Project">
            <ProjectPicker
              value={optimisticTask.project?.id ?? null}
              changeAction={changeProjectAction}
              pending={isSaving}
            />
          </Field>

          <Field label="Due date">
            <Input
              type="date"
              value={toDateInputValue(optimisticTask.dueDate)}
              onChange={(event) => {
                const dueDate = fromDateInputValue(event.target.value);
                changeDueDateAction(dueDate);
              }}
              className="h-9"
            />
          </Field>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Labels
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {optimisticTask.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2 pr-1 text-[11px] font-medium text-muted-foreground"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    accent(label.color).dot,
                  )}
                />
                {label.name}
                <button
                  type="button"
                  onClick={() => removeLabelAction(label.id)}
                  className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-rose"
                  aria-label={`Remove ${label.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <LabelPicker
              selectedIds={optimisticTask.labels.map((label) => label.id)}
              addAction={addLabelAction}
              removeAction={removeLabelAction}
            />
          </div>
        </div>

        <p className="pt-1 text-xs text-muted-foreground">
          Updated {formatRelative(optimisticTask.updatedAt)}
        </p>
      </div>
    </div>
  );
}

type OptimisticTaskChange =
  | { type: "update"; input: UpdateTaskInput }
  | { type: "addLabel"; label: TeamLabel }
  | { type: "removeLabel"; labelId: string };

type SaveAction = {
  errorMessage: string;
  run: () => Promise<unknown>;
  onSuccess?: () => void;
};

function useSavedNotice(): [boolean, () => void] {
  const [isVisible, setIsVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const show = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setIsVisible(true);
    timerRef.current = setTimeout(() => {
      setIsVisible(false);
      timerRef.current = null;
    }, 1200);
  }, []);

  return [isVisible, show];
}

function applyOptimisticTaskChange(
  task: Task,
  change: OptimisticTaskChange,
  refs: { members: TeamMember[]; projects: ProjectRef[] },
): Task {
  const updatedAt = new Date().toISOString();

  if (change.type === "addLabel") {
    if (task.labels.some((label) => label.id === change.label.id)) {
      return task;
    }

    return {
      ...task,
      labels: [...task.labels, change.label],
      updatedAt,
    };
  }

  if (change.type === "removeLabel") {
    return {
      ...task,
      labels: task.labels.filter((label) => label.id !== change.labelId),
      updatedAt,
    };
  }

  const { input } = change;

  const next: Task = {
    ...task,
    updatedAt,
  };

  if ("title" in input && input.title !== undefined) {
    next.title = input.title;
  }

  if ("description" in input && input.description !== undefined) {
    next.description = input.description;
  }

  if ("status" in input && input.status !== undefined) {
    next.status = input.status;
  }

  if ("priority" in input && input.priority !== undefined) {
    next.priority = input.priority;
  }

  if ("dueDate" in input) {
    next.dueDate = input.dueDate ?? null;
  }

  if ("assigneeId" in input) {
    next.assignee = input.assigneeId
      ? refs.members.find((member) => member.id === input.assigneeId) ??
        task.assignee
      : null;
  }

  if ("projectId" in input) {
    const moved = input.projectId
      ? refs.projects.find((project) => project.id === input.projectId)
      : null;
    // The roster this picks from no longer carries a task count, and the copy
    // of the project hanging off a task still has the field. Nothing renders it
    // — the header shows a name and a dot — and the confirmed task from the
    // round trip replaces this within the same transition, so the placeholder
    // never outlives the overlay.
    next.project = input.projectId
      ? moved
        ? { ...moved, taskCount: 0 }
        : task.project
      : null;
  }

  return next;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TitleEditor({
  value,
  isClosed,
  saveAction,
}: {
  value: string;
  isClosed: boolean;
  saveAction: (title: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  function commit() {
    const next = draft.trim();
    if (next && next !== value) {
      saveAction(next);
    } else if (!next) {
      setDraft(value);
    }
  }

  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      rows={2}
      className={cn(
        "min-h-0 resize-none border-transparent bg-transparent px-0 text-lg font-semibold leading-snug shadow-none focus-visible:border-transparent focus-visible:ring-0",
        isClosed && "text-muted-foreground line-through decoration-1",
      )}
    />
  );
}

function DescriptionEditor({
  value,
  saveAction,
}: {
  value: string;
  saveAction: (description: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  function commit() {
    if (draft.trim() !== value.trim()) {
      saveAction(draft.trim());
    }
  }

  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      placeholder="Add a description…"
      rows={4}
      className="resize-none border-border/70 bg-background/50 text-sm leading-relaxed"
    />
  );
}

