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
} from "@/app/lane-spa/api/hooks";
import { taskCacheStrategies } from "@/app/lane-spa/api/task-cache-sync";
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
import { DependencyStatus } from "./dependency-status";
import { PriorityControl } from "./priority-control";
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
  return (
    <DetailShell>
      <React.Suspense fallback={<DetailSkeleton />}>
        {taskId ? (
          <TaskDetail
            key={taskId}
            taskId={taskId}
            onClose={onClose}
            onSelectTask={onSelectTask}
          />
        ) : (
        <EmptyState
          icon={MousePointerClick}
          title="No task selected"
          message="Pick a task from the list to see and edit its details here."
          className="h-full"
        />
        )}
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
  onSelectTask,
}: {
  taskId: string;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const task = React.use(useTask(taskId).promise).data;
  const projects = React.use(useProjects().promise).data;
  const members = React.use(useMembers().promise).data;
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
  const [isSaving, startSaving] = React.useTransition();
  const [optimisticTask, addOptimisticTask] = React.useOptimistic(
    task,
    (current, change: OptimisticTaskChange) =>
      applyOptimisticTaskChange(current, change, { members, projects }),
  );

  const isClosed = STATUS_META[optimisticTask.status].group === "closed";
  const titleValue =
    titleEdit && titleEdit.draft !== titleEdit.base
      ? titleEdit.draft
      : optimisticTask.title;
  const descriptionValue =
    descriptionEdit && descriptionEdit.draft !== descriptionEdit.base
      ? descriptionEdit.draft
      : optimisticTask.description;
  const isStatusSaving =
    isSaving && optimisticTask.status !== task.status;
  const isPrioritySaving =
    isSaving && optimisticTask.priority !== task.priority;
  const isAssigneeSaving =
    isSaving &&
    (optimisticTask.assignee?.id ?? null) !== (task.assignee?.id ?? null);
  const isProjectSaving =
    isSaving &&
    (optimisticTask.project?.id ?? null) !== (task.project?.id ?? null);

  function changeTitleDraft(draft: string) {
    const revision = ++titleRevisionRef.current;
    setTitleEdit((current) => ({
      base:
        current && current.draft !== current.base
          ? current.base
          : optimisticTask.title,
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
    if (title === optimisticTask.title) {
      setTitleEdit(null);
      return;
    }

    const submittedRevision = titleEdit.revision;
    const input = { title };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        const savedTask = await update(
          input,
          taskCacheStrategies.searchText,
        );
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
          : optimisticTask.description,
      draft,
      revision,
    }));
  }

  function submitDescriptionAction() {
    if (!descriptionEdit) return;

    const description = descriptionValue.trim();
    if (description === optimisticTask.description.trim()) {
      setDescriptionEdit(null);
      return;
    }

    const submittedRevision = descriptionEdit.revision;
    const input = { description };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        const savedTask = await update(
          input,
          taskCacheStrategies.searchText,
        );
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

  function changeStatusAction(status: Task["status"]) {
    const input = { status };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        await update(input, taskCacheStrategies.status);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't update status", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function changePriorityAction(priority: Task["priority"]) {
    const input = { priority };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        await update(input, taskCacheStrategies.priority);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't update priority", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function changeAssigneeAction(assigneeId: string | null) {
    const input = { assigneeId };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        await update(input, taskCacheStrategies.assignee);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't update assignee", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function changeProjectAction(projectId: string | null) {
    const input = { projectId };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        await update(input, taskCacheStrategies.project);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't move task", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function changeDueDateAction(dueDate: string | null) {
    const input = { dueDate };
    startSaving(async () => {
      addOptimisticTask({ type: "update", input });

      try {
        await update(input, taskCacheStrategies.dueDate);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't update due date", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function addLabelAction(label: TeamLabel) {
    startSaving(async () => {
      addOptimisticTask({ type: "addLabel", label });

      try {
        await addLabel(label);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't add label", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  function removeLabelAction(labelId: string) {
    startSaving(async () => {
      addOptimisticTask({ type: "removeLabel", labelId });

      try {
        await removeLabel(labelId);
        React.startTransition(showSavedNotice);
      } catch (error) {
        toast.error("Couldn't remove label", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  const handleDelete = () => {
    startSaving(async () => {
      try {
        await remove(task);
        React.startTransition(() => {
          toast.success("Task deleted");
          onClose();
        });
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
              value={optimisticTask.status}
              changeAction={changeStatusAction}
              pending={isStatusSaving}
            />
          </Field>

          <Field label="Priority">
            <PriorityControl
              value={optimisticTask.priority}
              changeAction={changePriorityAction}
              pending={isPrioritySaving}
            />
          </Field>

          <Field label="Assignee">
            <AssigneePicker
              value={optimisticTask.assignee?.id ?? null}
              changeAction={changeAssigneeAction}
              pending={isAssigneeSaving}
            />
          </Field>

          <Field label="Project">
            <ProjectPicker
              value={optimisticTask.project?.id ?? null}
              changeAction={changeProjectAction}
              pending={isProjectSaving}
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

        <Separator />

        <DependencyStatus task={task} onSelectTask={onSelectTask} />

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

type TextEdit = {
  base: string;
  draft: string;
  revision: number;
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
