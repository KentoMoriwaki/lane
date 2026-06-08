"use client";

import type { Task, UpdateTaskInput } from "@lane/todo-api";
import { Check, MousePointerClick, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  useAddTaskLabel,
  useDeleteTask,
  useRemoveTaskLabel,
  useTask,
  useUpdateTask,
} from "@/api/hooks";
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
import { EmptyState, InlineSpinner } from "./feedback";
import { LabelChip } from "./task-bits";
import { LabelPicker } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { ProjectPicker } from "./project-picker";
import { StatusControl } from "./status-control";

export function TaskDetailPanel({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
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
      <React.Suspense fallback={<DetailSkeleton />}>
        <TaskDetail taskId={taskId} onClose={onClose} />
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
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const task = React.use(useTask(taskId).promise);
  const update = useUpdateTask(taskId);
  const addLabel = useAddTaskLabel(taskId);
  const removeLabel = useRemoveTaskLabel(taskId);
  const remove = useDeleteTask();
  const [isSaving, startSaveTransition] = React.useTransition();

  const isClosed = STATUS_META[task.status].group === "closed";

  function runAction(action: () => Promise<unknown>, errorMessage: string) {
    startSaveTransition(async () => {
      try {
        await action();
      } catch (error) {
        toast.error(errorMessage, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function saveTask(input: UpdateTaskInput, errorMessage: string) {
    runAction(() => update(input), errorMessage);
  }

  const handleDelete = () => {
    startSaveTransition(async () => {
      try {
        await remove(task.id);
        toast.success("Task deleted");
        onClose();
      } catch (error) {
        toast.error("Couldn't delete task", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
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
          ) : (
            <span className="inline-flex items-center gap-1 text-sage">
              <Check className="size-3" /> Saved
            </span>
          )}
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
          onSave={(title) =>
            saveTask({ title }, "Couldn't save title")
          }
        />

        <DescriptionEditor
          key={`desc:${task.id}`}
          value={task.description}
          onSave={(description) =>
            saveTask({ description }, "Couldn't save description")
          }
        />

        <Separator />

        <div className="space-y-3">
          <Field label="Status">
            <StatusControl
              value={task.status}
              onChange={(status) =>
                saveTask({ status }, "Couldn't update status")
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Priority">
            <PriorityControl
              value={task.priority}
              onChange={(priority) =>
                saveTask({ priority }, "Couldn't update priority")
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Assignee">
            <AssigneePicker
              value={task.assignee?.id ?? null}
              onChange={(assigneeId) =>
                saveTask({ assigneeId }, "Couldn't update assignee")
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Project">
            <ProjectPicker
              value={task.project?.id ?? null}
              onChange={(projectId) =>
                saveTask({ projectId }, "Couldn't move task")
              }
              pending={isSaving}
            />
          </Field>

          <Field label="Due date">
            <Input
              type="date"
              value={toDateInputValue(task.dueDate)}
              onChange={(event) =>
                saveTask(
                  { dueDate: fromDateInputValue(event.target.value) },
                  "Couldn't update due date",
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
                    runAction(
                      () => removeLabel(label.id),
                      "Couldn't remove label",
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
              selectedIds={task.labels.map((label) => label.id)}
              onAdd={(label) =>
                runAction(() => addLabel(label), "Couldn't add label")
              }
              onRemove={(labelId) =>
                runAction(() => removeLabel(labelId), "Couldn't remove label")
              }
            />
          </div>
        </div>

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

function TitleEditor({
  value,
  isClosed,
  onSave,
}: {
  value: string;
  isClosed: boolean;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  function commit() {
    const next = draft.trim();
    if (next && next !== value) {
      onSave(next);
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
  onSave,
}: {
  value: string;
  onSave: (description: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  function commit() {
    if (draft.trim() !== value.trim()) {
      onSave(draft.trim());
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
