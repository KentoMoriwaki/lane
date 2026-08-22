"use client";

import type {
  Task,
  TeamLabel,
  TeamMember,
  UpdateTaskInput,
} from "@/server/api";
import type { ProjectRef } from "@/app/lane/api/route-reads";
import type { ProjectTaskCounts } from "@/app/lane/api/endpoints";
import { Check, MousePointerClick, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  addTaskLabelAction,
  deleteTaskAction,
  removeTaskLabelAction,
  updateTaskAction,
} from "@/app/lane/api/actions";
import { EmptyState, InlineSpinner } from "@/app/lane/workspace/feedback";
import { PriorityControl } from "@/app/lane/workspace/priority-control";
import { StatusControl } from "@/app/lane/workspace/status-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { accent } from "@/lib/accent";
import {
  formatRelative,
  fromDateInputValue,
  toDateInputValue,
} from "@/lib/format";
import { STATUS_META } from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { LabelPicker } from "./label-picker";
import { ProjectPicker } from "./project-picker";
import type { WorkspaceContext } from "./workspace";

export function TaskDetail({
  ctx,
  taskId,
  task,
  members,
  projects,
  projectCounts,
  labels,
  onClose,
}: {
  ctx: WorkspaceContext;
  taskId: string | null;
  task: Task | null;
  members: TeamMember[];
  projects: ProjectRef[];
  projectCounts: ProjectTaskCounts;
  labels: TeamLabel[];
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

  if (!task) {
    return (
      <DetailShell>
        <EmptyState
          icon={MousePointerClick}
          title="Task unavailable"
          message="This task no longer exists or is not available in this team."
          action={
            <Button variant="link" onClick={onClose} className="text-cobalt">
              Close panel
            </Button>
          }
          className="h-full"
        />
      </DetailShell>
    );
  }

  return (
    <DetailShell>
      <TaskDetailContent
        key={task.id}
        ctx={ctx}
        task={task}
        members={members}
        projects={projects}
        projectCounts={projectCounts}
        labels={labels}
        onClose={onClose}
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

function TaskDetailContent({
  ctx,
  task,
  members,
  projects,
  projectCounts,
  labels,
  onClose,
}: {
  ctx: WorkspaceContext;
  task: Task;
  members: TeamMember[];
  projects: ProjectRef[];
  projectCounts: ProjectTaskCounts;
  labels: TeamLabel[];
  onClose: () => void;
}) {
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

  function updateOptimistically(input: UpdateTaskInput, errorMessage: string) {
    React.startTransition(() => {
      addOptimisticTask({ type: "update", input });
      dispatchSaveAction({
        errorMessage,
        onSuccess: showSavedNotice,
        run: () => updateTaskAction(ctx, task.id, input),
      });
    });
  }

  function addLabel(label: TeamLabel) {
    React.startTransition(() => {
      addOptimisticTask({ type: "addLabel", label });
      dispatchSaveAction({
        errorMessage: "Couldn't add label",
        onSuccess: showSavedNotice,
        run: () => addTaskLabelAction(ctx, task.id, label.id),
      });
    });
  }

  function removeLabel(labelId: string) {
    React.startTransition(() => {
      addOptimisticTask({ type: "removeLabel", labelId });
      dispatchSaveAction({
        errorMessage: "Couldn't remove label",
        onSuccess: showSavedNotice,
        run: () => removeTaskLabelAction(ctx, task.id, labelId),
      });
    });
  }

  function handleDelete() {
    React.startTransition(() => {
      dispatchSaveAction({
        errorMessage: "Couldn't delete task",
        run: () => deleteTaskAction(ctx, task.id),
        onSuccess: () => {
          toast.success("Task deleted");
          onClose();
        },
      });
    });
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
          value={optimisticTask.title}
          isClosed={isClosed}
          saveAction={(title) =>
            updateOptimistically({ title }, "Couldn't save title")
          }
        />
        <DescriptionEditor
          value={optimisticTask.description}
          saveAction={(description) =>
            updateOptimistically({ description }, "Couldn't save description")
          }
        />
        <Separator />
        <div className="space-y-3">
          <Field label="Status">
            <StatusControl
              value={optimisticTask.status}
              changeAction={(status) =>
                updateOptimistically({ status }, "Couldn't update status")
              }
              pending={isSaving}
            />
          </Field>
          <Field label="Priority">
            <PriorityControl
              value={optimisticTask.priority}
              changeAction={(priority) =>
                updateOptimistically({ priority }, "Couldn't update priority")
              }
              pending={isSaving}
            />
          </Field>
          <Field label="Assignee">
            <AssigneePicker
              members={members}
              value={optimisticTask.assignee?.id ?? null}
              changeAction={(assigneeId) =>
                updateOptimistically({ assigneeId }, "Couldn't update assignee")
              }
              pending={isSaving}
            />
          </Field>
          <Field label="Project">
            <ProjectPicker
              ctx={ctx}
              projects={projects}
              projectCounts={projectCounts}
              value={optimisticTask.project?.id ?? null}
              changeAction={(projectId) =>
                updateOptimistically({ projectId }, "Couldn't move task")
              }
              pending={isSaving}
            />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              aria-label="Task due date"
              value={toDateInputValue(optimisticTask.dueDate)}
              onChange={(event) =>
                updateOptimistically(
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
                  onClick={() => removeLabel(label.id)}
                  className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-rose"
                  aria-label={`Remove ${label.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <LabelPicker
              ctx={ctx}
              labels={labels}
              selectedIds={optimisticTask.labels.map((label) => label.id)}
              addAction={addLabel}
              removeAction={removeLabel}
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

function applyOptimisticTaskChange(
  task: Task,
  change: OptimisticTaskChange,
  refs: { members: TeamMember[]; projects: ProjectRef[] },
): Task {
  const updatedAt = new Date().toISOString();
  if (change.type === "addLabel") {
    if (task.labels.some((label) => label.id === change.label.id)) return task;
    return { ...task, labels: [...task.labels, change.label], updatedAt };
  }
  if (change.type === "removeLabel") {
    return {
      ...task,
      labels: task.labels.filter((label) => label.id !== change.labelId),
      updatedAt,
    };
  }

  const { input } = change;
  const next: Task = { ...task, updatedAt };
  if (input.title !== undefined) next.title = input.title;
  if (input.description !== undefined) next.description = input.description;
  if (input.status !== undefined) next.status = input.status;
  if (input.priority !== undefined) next.priority = input.priority;
  if ("dueDate" in input) next.dueDate = input.dueDate ?? null;
  if ("assigneeId" in input) {
    next.assignee = input.assigneeId
      ? (refs.members.find((member) => member.id === input.assigneeId) ??
        task.assignee)
      : null;
  }
  if ("projectId" in input) {
    // The roster no longer carries a task count (`route-reads.ts`); nothing
    // renders the one on a task's own copy of its project, and the action's
    // response replaces this overlay in the same transition.
    const moved = input.projectId
      ? refs.projects.find((project) => project.id === input.projectId)
      : undefined;
    next.project = input.projectId
      ? moved
        ? { ...moved, taskCount: 0 }
        : task.project
      : null;
  }
  return next;
}

function useSavedNotice(): [boolean, () => void] {
  const [isVisible, setIsVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
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
    if (next && next !== value) saveAction(next);
    else if (!next) setDraft(value);
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
      aria-label="Task title"
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
  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== value.trim()) saveAction(draft.trim());
      }}
      placeholder="Add a description…"
      rows={4}
      aria-label="Task description"
      className="resize-none border-border/70 bg-background/50 text-sm leading-relaxed"
    />
  );
}
