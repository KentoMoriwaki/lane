"use client";

import { Check, MousePointerClick, Trash2, X } from "lucide-react";
import * as React from "react";
import { graphql, usePreloadedQuery, useFragment } from "react-relay";
import type { PreloadedQuery } from "react-relay";
import { toast } from "sonner";
import {
  useAddTaskLabel,
  useDeleteTask,
  useRemoveTaskLabel,
  useUpdateTask,
} from "@/app/relay/api/mutations";
import { useWorkspaceRefresh } from "@/app/relay/api/workspace-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { accent } from "@/lib/accent";
import {
  formatRelative,
  toDateInputValue,
  fromDateInputValue,
} from "@/lib/format";
import { STATUS_META } from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import type { RelayTaskDetailQuery } from "@/app/relay/__generated__/RelayTaskDetailQuery.graphql";
import type { taskDetailPanel_task$key } from "@/app/relay/__generated__/taskDetailPanel_task.graphql";
import { AssigneePicker } from "./assignee-picker";
import { DependencyStatus } from "./dependency-status";
import { EmptyState, InlineSpinner } from "./feedback";
import { LabelPicker, type PickerLabel } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { ProjectPicker } from "./project-picker";
import { StatusControl } from "./status-control";

export const taskDetailQuery = graphql`
  query RelayTaskDetailQuery($id: ID!) {
    task(id: $id) {
      id
      ...taskDetailPanel_task
      ...dependencyStatus_task @defer
    }
  }
`;

const taskDetailFragment = graphql`
  fragment taskDetailPanel_task on Task {
    id
    title
    description
    status
    priority
    dueDate
    updatedAt
    assignee {
      id
      name
      initials
      color
    }
    project {
      id
      name
      color
    }
    labels {
      id
      name
      color
    }
  }
`;

type DetailTask = NonNullable<ReturnType<typeof useTaskFragment>>;

function useTaskFragment(taskRef: taskDetailPanel_task$key) {
  return useFragment(taskDetailFragment, taskRef);
}

export function TaskDetailPanel({
  queryRef,
  taskId,
  onClose,
  onSelectTask,
}: {
  queryRef: PreloadedQuery<RelayTaskDetailQuery> | null;
  taskId: string | null;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  if (!queryRef || !taskId) {
    return (
      <DetailShell>
        <EmptyState
          icon={MousePointerClick}
          title="No task selected"
          message="Pick a task from the list to see and edit its details here."
          className="h-full"
        />
      </DetailShell>
    );
  }

  return (
    <DetailShell>
      <React.Suspense key={taskId} fallback={<DetailSkeleton />}>
        <TaskDetail
          queryRef={queryRef}
          onClose={onClose}
          onSelectTask={onSelectTask}
        />
      </React.Suspense>
    </DetailShell>
  );
}

function DetailShell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="scrollbar-calm hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface lg:block">
      {children}
    </aside>
  );
}

function TaskDetail({
  queryRef,
  onClose,
  onSelectTask,
}: {
  queryRef: PreloadedQuery<RelayTaskDetailQuery>;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const data = usePreloadedQuery<RelayTaskDetailQuery>(
    taskDetailQuery,
    queryRef,
  );

  if (!data.task) {
    return (
      <EmptyState
        icon={MousePointerClick}
        title="Task not found"
        message="It may have been deleted."
        className="h-full"
      />
    );
  }

  return (
    <TaskDetailBody
      taskRef={data.task}
      dependencyRef={data.task}
      onClose={onClose}
      onSelectTask={onSelectTask}
    />
  );
}

function TaskDetailBody({
  taskRef,
  dependencyRef,
  onClose,
  onSelectTask,
}: {
  taskRef: taskDetailPanel_task$key;
  dependencyRef: React.ComponentProps<typeof DependencyStatus>["task"];
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const task = useTaskFragment(taskRef);
  const update = useUpdateTask(task.id);
  const addLabel = useAddTaskLabel(task.id);
  const removeLabel = useRemoveTaskLabel(task.id);
  const remove = useDeleteTask();
  const { notifyMutation } = useWorkspaceRefresh();
  const [isSavedVisible, showSavedNotice] = useSavedNotice();
  const [optimisticTask, addOptimisticTask] = React.useOptimistic(
    task,
    (current: DetailTask, change: OptimisticTaskChange) =>
      applyOptimisticTaskChange(current, change),
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const isClosed = STATUS_META[optimisticTask.status].group === "closed";

  function runSave(change: OptimisticTaskChange, action: SaveAction) {
    // Fire the mutation URGENTLY — outside the awaiting transition — so the
    // normalized store reflects scalar edits across every view at once: the row
    // in the list updates immediately, not when the server responds. A local
    // optimistic snapshot, held until the mutation settles, covers the
    // relation/label fields the scalar store-updater doesn't reach.
    setIsSaving(true);
    const settled = action.run();
    React.startTransition(async () => {
      addOptimisticTask(change);
      try {
        await settled;
      } catch {
        // Surfaced by the `.catch` below.
      }
    });
    settled
      .then(() => {
        // Counters can shift; under an active filter, membership too.
        notifyMutation("edit");
        action.onSuccess?.();
      })
      .catch((error) =>
        toast.error(action.errorMessage, {
          description: error instanceof Error ? error.message : undefined,
        }),
      )
      .finally(() => setIsSaving(false));
  }

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
            onClick={() => {
              // The optimistic `store.delete` drops the task from every list at
              // once, so close the panel immediately rather than waiting on the
              // server (Relay rolls the delete back if it rejects).
              onClose();
              remove(task.id)
                .then(() => {
                  notifyMutation("delete");
                  toast.success("Task deleted");
                })
                .catch((error) =>
                  toast.error("Couldn't delete task", {
                    description:
                      error instanceof Error ? error.message : undefined,
                  }),
                );
            }}
            aria-label="Delete task"
            className="text-muted-foreground hover:text-rose"
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <TitleEditor
          key={`title:${optimisticTask.id}`}
          value={optimisticTask.title}
          isClosed={isClosed}
          saveAction={(title) =>
            runSave(
              { type: "patch", input: { title } },
              {
                errorMessage: "Couldn't save title",
                onSuccess: showSavedNotice,
                run: () => update({ title }),
              },
            )
          }
        />

        <DescriptionEditor
          key={`desc:${optimisticTask.id}`}
          value={optimisticTask.description}
          saveAction={(description) =>
            runSave(
              { type: "patch", input: { description } },
              {
                errorMessage: "Couldn't save description",
                onSuccess: showSavedNotice,
                run: () => update({ description }),
              },
            )
          }
        />

        <Separator />

        <div className="space-y-3">
          <Field label="Status">
            <StatusControl
              value={optimisticTask.status}
              changeAction={(status) =>
                runSave(
                  { type: "patch", input: { status } },
                  {
                    errorMessage: "Couldn't update status",
                    onSuccess: showSavedNotice,
                    run: () => update({ status }),
                  },
                )
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Priority">
            <PriorityControl
              value={optimisticTask.priority}
              changeAction={(priority) =>
                runSave(
                  { type: "patch", input: { priority } },
                  {
                    errorMessage: "Couldn't update priority",
                    onSuccess: showSavedNotice,
                    run: () => update({ priority }),
                  },
                )
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Assignee">
            <AssigneePicker
              value={optimisticTask.assignee?.id ?? null}
              selected={optimisticTask.assignee ?? null}
              changeAction={(member) =>
                runSave(
                  { type: "assignee", assignee: member },
                  {
                    errorMessage: "Couldn't update assignee",
                    onSuccess: showSavedNotice,
                    run: () => update({ assigneeId: member?.id ?? null }),
                  },
                )
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Project">
            <ProjectPicker
              value={optimisticTask.project?.id ?? null}
              selected={optimisticTask.project ?? null}
              changeAction={(project) =>
                runSave(
                  { type: "project", project },
                  {
                    errorMessage: "Couldn't move task",
                    onSuccess: showSavedNotice,
                    run: () => update({ projectId: project?.id ?? null }),
                  },
                )
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Due date">
            <Input
              type="date"
              value={toDateInputValue(optimisticTask.dueDate ?? null)}
              onChange={(event) => {
                const dueDate = fromDateInputValue(event.target.value);
                runSave(
                  { type: "patch", input: { dueDate } },
                  {
                    errorMessage: "Couldn't update due date",
                    onSuccess: showSavedNotice,
                    run: () => update({ dueDate }),
                  },
                );
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
                  onClick={() =>
                    runSave(
                      { type: "removeLabel", labelId: label.id },
                      {
                        errorMessage: "Couldn't remove label",
                        onSuccess: showSavedNotice,
                        run: () => removeLabel(label.id),
                      },
                    )
                  }
                  className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-rose"
                  aria-label={`Remove ${label.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <LabelPicker
              selectedIds={optimisticTask.labels.map((label) => label.id)}
              addAction={(label) =>
                runSave(
                  { type: "addLabel", label },
                  {
                    errorMessage: "Couldn't add label",
                    onSuccess: showSavedNotice,
                    run: () => addLabel(label.id),
                  },
                )
              }
              removeAction={(labelId) =>
                runSave(
                  { type: "removeLabel", labelId },
                  {
                    errorMessage: "Couldn't remove label",
                    onSuccess: showSavedNotice,
                    run: () => removeLabel(labelId),
                  },
                )
              }
            />
          </div>
        </div>

        <Separator />

        <React.Suspense fallback={<Skeleton className="h-7 w-full" />}>
          <DependencyStatus task={dependencyRef} onSelectTask={onSelectTask} />
        </React.Suspense>

        <p className="pt-1 text-xs text-muted-foreground">
          Updated {formatRelative(optimisticTask.updatedAt)}
        </p>
      </div>
    </div>
  );
}

type OptimisticTaskChange =
  | { type: "none" }
  | { type: "patch"; input: PatchInput }
  | { type: "assignee"; assignee: DetailTask["assignee"] }
  | { type: "project"; project: DetailTask["project"] }
  | { type: "addLabel"; label: PickerLabel }
  | { type: "removeLabel"; labelId: string };

type PatchInput = {
  title?: string;
  description?: string;
  status?: DetailTask["status"];
  priority?: DetailTask["priority"];
  dueDate?: string | null;
};

type SaveAction = {
  errorMessage: string;
  run: () => Promise<unknown>;
  onSuccess?: () => void;
};

function applyOptimisticTaskChange(
  task: DetailTask,
  change: OptimisticTaskChange,
): DetailTask {
  const updatedAt = new Date().toISOString();

  if (change.type === "none") {
    return task;
  }

  if (change.type === "assignee") {
    return { ...task, assignee: change.assignee, updatedAt };
  }

  if (change.type === "project") {
    return { ...task, project: change.project, updatedAt };
  }

  if (change.type === "addLabel") {
    if (task.labels.some((label) => label.id === change.label.id)) {
      return task;
    }
    return {
      ...task,
      labels: [...task.labels, change.label].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
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

  const next = { ...task, updatedAt } as DetailTask & {
    title: string;
    description: string;
    status: DetailTask["status"];
    priority: DetailTask["priority"];
    dueDate: string | null;
  };
  const { input } = change;
  if (input.title !== undefined) next.title = input.title;
  if (input.description !== undefined) next.description = input.description;
  if (input.status !== undefined) next.status = input.status;
  if (input.priority !== undefined) next.priority = input.priority;
  if (input.dueDate !== undefined) next.dueDate = input.dueDate;
  return next;
}

function useSavedNotice(): [boolean, () => void] {
  const [isVisible, setIsVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const show = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsVisible(true);
    timerRef.current = setTimeout(() => {
      setIsVisible(false);
      timerRef.current = null;
    }, 1200);
  }, []);

  return [isVisible, show];
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

function DetailSkeleton() {
  return (
    <div className="space-y-5 p-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-20 w-full" />
      <Separator />
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[88px_1fr] items-center gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}
