"use client";

import type {
  Project,
  Task,
  TeamLabel,
  TeamMember,
  UpdateTaskInput,
} from "@/server/api";
import { Check, MousePointerClick, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  useAddTaskLabel,
  useDeleteTask,
  useMembers,
  useProjects,
  useRemoveTaskLabel,
  useTask,
  useUpdateTask,
} from "@/app/lane/api/hooks";
import { taskCacheStrategies } from "@/app/lane/api/task-cache-sync";
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
      <React.Suspense key={taskId} fallback={<DetailSkeleton />}>
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
  const projects = React.use(useProjects().promise);
  const members = React.use(useMembers().promise);
  const update = useUpdateTask(taskId);
  const addLabel = useAddTaskLabel(taskId);
  const removeLabel = useRemoveTaskLabel(taskId);
  const remove = useDeleteTask();
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
        run: () => update(input, taskCacheStrategies.searchText),
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
        run: () => update(input, taskCacheStrategies.searchText),
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
        run: () => update(input, taskCacheStrategies.status),
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
        run: () => update(input, taskCacheStrategies.priority),
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
        run: () => update(input, taskCacheStrategies.assignee),
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
        run: () => update(input, taskCacheStrategies.project),
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
        run: () => update(input, taskCacheStrategies.dueDate),
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
          onClose();
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
  refs: { members: TeamMember[]; projects: Project[] },
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
    next.project = input.projectId
      ? refs.projects.find((project) => project.id === input.projectId) ??
        task.project
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
