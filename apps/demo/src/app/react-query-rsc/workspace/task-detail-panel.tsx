"use client";

import type { Task } from "@/server/api";
import { Check, MousePointerClick, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  useAddTaskLabel,
  useDeleteTask,
  useRemoveTaskLabel,
  useTask,
  useUpdateTask,
} from "@/app/react-query-rsc/api/hooks";
import { taskCacheStrategies } from "@/app/react-query-rsc/api/task-cache-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { accent } from "@/lib/accent";
import { formatRelative, toDateInputValue, fromDateInputValue } from "@/lib/format";
import { STATUS_META } from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { EmptyState, InlineSpinner, SectionError } from "./feedback";
import { LabelChip } from "./task-bits";
import { LabelPicker } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { DependencyStatus } from "./dependency-status";
import { ProjectPicker } from "./project-picker";
import { StatusControl } from "./status-control";

export function TaskDetailPanel({
  taskId,
  onClose,
  onSelectTask,
}: {
  taskId: string | null;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  if (!taskId) {
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
      <TaskDetail
        key={taskId}
        taskId={taskId}
        onClose={onClose}
        onSelectTask={onSelectTask}
      />
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
  taskId,
  onClose,
  onSelectTask,
}: {
  taskId: string;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const { data: task, isPending, isError, error, refetch, isFetching } =
    useTask(taskId);
  const update = useUpdateTask(taskId);
  const addLabel = useAddTaskLabel(taskId);
  const removeLabel = useRemoveTaskLabel(taskId);
  const remove = useDeleteTask();
  const [isSavedVisible, showSavedNotice] = useSavedNotice();

  if (isPending) {
    return <DetailSkeleton />;
  }

  if (isError) {
    return (
      <div className="p-4">
        <SectionError
          title="Couldn't load this task"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (!task) {
    return <DetailSkeleton />;
  }

  const isClosed = STATUS_META[task.status].group === "closed";
  const isSaving =
    update.isPending || addLabel.isPending || removeLabel.isPending;

  const onMutationError = (message: string) => (mutationError: unknown) =>
    toast.error(message, {
      description:
        mutationError instanceof Error ? mutationError.message : undefined,
    });

  const handleDelete = () => {
    remove.mutate(task.id, {
      onSuccess: () => {
        toast.success("Task deleted");
        onClose();
      },
      onError: onMutationError("Couldn't delete task"),
    });
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {task.project ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  accent(task.project.color).dot,
                )}
              />
              {task.project.name}
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
          key={`title:${task.id}`}
          value={task.title}
          isClosed={isClosed}
          saveAction={(title) =>
            update.mutate(
              { input: { title }, strategy: taskCacheStrategies.searchText },
              {
                onError: onMutationError("Couldn't save title"),
                onSuccess: showSavedNotice,
              },
            )
          }
        />

        <DescriptionEditor
          key={`desc:${task.id}`}
          value={task.description}
          saveAction={(description) =>
            update.mutate(
              {
                input: { description },
                strategy: taskCacheStrategies.searchText,
              },
              {
                onError: onMutationError("Couldn't save description"),
                onSuccess: showSavedNotice,
              },
            )
          }
        />

        <Separator />

        <div className="space-y-3">
          <Field label="Status">
            <StatusControl
              value={task.status}
              changeAction={(status) =>
                update.mutate(
                  { input: { status }, strategy: taskCacheStrategies.status },
                  {
                    onError: onMutationError("Couldn't update status"),
                    onSuccess: showSavedNotice,
                  },
                )
              }
              pending={update.isPending}
            />
          </Field>

          <Field label="Priority">
            <PriorityControl
              value={task.priority}
              changeAction={(priority) =>
                update.mutate(
                  {
                    input: { priority },
                    strategy: taskCacheStrategies.priority,
                  },
                  {
                    onError: onMutationError("Couldn't update priority"),
                    onSuccess: showSavedNotice,
                  },
                )
              }
              pending={update.isPending}
            />
          </Field>

          <Field label="Assignee">
            <AssigneePicker
              value={task.assignee?.id ?? null}
              changeAction={(assigneeId) =>
                update.mutate(
                  {
                    input: { assigneeId },
                    strategy: taskCacheStrategies.assignee,
                  },
                  {
                    onError: onMutationError("Couldn't update assignee"),
                    onSuccess: showSavedNotice,
                  },
                )
              }
              pending={update.isPending}
            />
          </Field>

          <Field label="Project">
            <ProjectPicker
              value={task.project?.id ?? null}
              changeAction={(projectId) =>
                update.mutate(
                  {
                    input: { projectId },
                    strategy: taskCacheStrategies.project,
                  },
                  {
                    onError: onMutationError("Couldn't move task"),
                    onSuccess: showSavedNotice,
                  },
                )
              }
              pending={update.isPending}
            />
          </Field>

          <Field label="Due date">
            <Input
              type="date"
              value={toDateInputValue(task.dueDate)}
              onChange={(event) =>
                update.mutate(
                  {
                    input: {
                      dueDate: fromDateInputValue(event.target.value),
                    },
                    strategy: taskCacheStrategies.dueDate,
                  },
                  {
                    onError: onMutationError("Couldn't update due date"),
                    onSuccess: showSavedNotice,
                  },
                )
              }
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
            {task.labels.map((label) => (
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
                    removeLabel.mutate(label.id, {
                      onError: onMutationError("Couldn't remove label"),
                      onSuccess: showSavedNotice,
                    })
                  }
                  className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-rose"
                  aria-label={`Remove ${label.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <LabelPicker
              selectedIds={task.labels.map((label) => label.id)}
              addAction={(label) =>
                addLabel.mutate(label, {
                  onError: onMutationError("Couldn't add label"),
                  onSuccess: showSavedNotice,
                })
              }
              removeAction={(labelId) =>
                removeLabel.mutate(labelId, {
                  onError: onMutationError("Couldn't remove label"),
                  onSuccess: showSavedNotice,
                })
              }
            />
          </div>
        </div>

        <Separator />

        <DependencyStatus task={task} onSelectTask={onSelectTask} />

        <p
          className="pt-1 text-xs text-muted-foreground"
          data-task-updated-at={task.updatedAt}
        >
          Updated {formatRelative(task.updatedAt)}
        </p>
      </div>
    </div>
  );
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
