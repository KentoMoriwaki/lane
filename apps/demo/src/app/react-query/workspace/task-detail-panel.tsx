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
} from "@/app/react-query/api/hooks";
import { taskCacheStrategies } from "@/app/react-query/api/task-cache-sync";
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
  const [titleEdit, setTitleEdit] = React.useState<TextEdit | null>(null);
  const [descriptionEdit, setDescriptionEdit] =
    React.useState<TextEdit | null>(null);
  const titleRevisionRef = React.useRef(0);
  const descriptionRevisionRef = React.useRef(0);
  const [isTextSaving, startTextSave] = React.useTransition();

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

  const loadedTask = task;
  const isClosed = STATUS_META[loadedTask.status].group === "closed";
  const isSaving =
    isTextSaving ||
    update.isPending ||
    addLabel.isPending ||
    removeLabel.isPending;
  const titleValue =
    titleEdit && titleEdit.draft !== titleEdit.base
      ? titleEdit.draft
      : task.title;
  const descriptionValue =
    descriptionEdit && descriptionEdit.draft !== descriptionEdit.base
      ? descriptionEdit.draft
      : task.description;
  const taskBeforeUpdate = update.context?.detail;
  const isStatusSaving =
    update.isPending &&
    taskBeforeUpdate !== undefined &&
    task.status !== taskBeforeUpdate.status;
  const isPrioritySaving =
    update.isPending &&
    taskBeforeUpdate !== undefined &&
    task.priority !== taskBeforeUpdate.priority;
  const isAssigneeSaving =
    update.isPending &&
    taskBeforeUpdate !== undefined &&
    (task.assignee?.id ?? null) !== (taskBeforeUpdate.assignee?.id ?? null);
  const isProjectSaving =
    update.isPending &&
    taskBeforeUpdate !== undefined &&
    (task.project?.id ?? null) !== (taskBeforeUpdate.project?.id ?? null);

  const onMutationError = (message: string) => (mutationError: unknown) =>
    toast.error(message, {
      description:
        mutationError instanceof Error ? mutationError.message : undefined,
    });

  const handleDelete = () => {
    remove.mutate(task, {
      onSuccess: () => {
        toast.success("Task deleted");
        onClose();
      },
      onError: onMutationError("Couldn't delete task"),
    });
  };

  function changeTitleDraft(draft: string) {
    const revision = ++titleRevisionRef.current;
    setTitleEdit((current) => ({
      base:
        current && current.draft !== current.base
          ? current.base
          : loadedTask.title,
      draft,
      revision,
    }));
  }

  function submitTitleAction() {
    if (!titleEdit) return;

    const title = titleValue.trim();
    if (!title) {
      setTitleEdit(null);
      return;
    }
    if (title === loadedTask.title) {
      setTitleEdit(null);
      return;
    }

    const submittedRevision = titleEdit.revision;
    startTextSave(async () => {
      try {
        const savedTask = await update.mutateAsync({
          input: { title },
          strategy: taskCacheStrategies.searchText,
        });
        React.startTransition(() => {
          setTitleEdit((current) => {
            if (!current || current.revision === submittedRevision) {
              return null;
            }

            return { ...current, base: savedTask.title };
          });
          showSavedNotice();
        });
      } catch (error) {
        toast.error("Couldn't save title", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function changeDescriptionDraft(draft: string) {
    const revision = ++descriptionRevisionRef.current;
    setDescriptionEdit((current) => ({
      base:
        current && current.draft !== current.base
          ? current.base
          : loadedTask.description,
      draft,
      revision,
    }));
  }

  function submitDescriptionAction() {
    if (!descriptionEdit) return;

    const description = descriptionValue.trim();
    if (description === loadedTask.description.trim()) {
      setDescriptionEdit(null);
      return;
    }

    const submittedRevision = descriptionEdit.revision;
    startTextSave(async () => {
      try {
        const savedTask = await update.mutateAsync({
          input: { description },
          strategy: taskCacheStrategies.searchText,
        });
        React.startTransition(() => {
          setDescriptionEdit((current) => {
            if (!current || current.revision === submittedRevision) {
              return null;
            }

            return { ...current, base: savedTask.description };
          });
          showSavedNotice();
        });
      } catch (error) {
        toast.error("Couldn't save description", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

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
          value={titleValue}
          isClosed={isClosed}
          onChange={changeTitleDraft}
          commitAction={submitTitleAction}
        />

        <DescriptionEditor
          value={descriptionValue}
          onChange={changeDescriptionDraft}
          commitAction={submitDescriptionAction}
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
              pending={isStatusSaving}
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
              pending={isPrioritySaving}
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
              pending={isAssigneeSaving}
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
              pending={isProjectSaving}
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

        <p className="pt-1 text-xs text-muted-foreground">
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

type TextEdit = {
  base: string;
  draft: string;
  revision: number;
};

function TitleEditor({
  value,
  isClosed,
  onChange,
  commitAction,
}: {
  value: string;
  isClosed: boolean;
  onChange: (value: string) => void;
  commitAction: () => void;
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={commitAction}
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
  onChange,
  commitAction,
}: {
  value: string;
  onChange: (value: string) => void;
  commitAction: () => void;
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={commitAction}
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
