"use client";

import type { TaskPriority, TaskStatus, TeamLabel } from "@/server/api";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useWorkspaceUrl } from "./use-workspace-url";
import { toast } from "sonner";
import { useCreateTask } from "@/app/lane/api/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { accent } from "@/lib/accent";
import { fromDateInputValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "./assignee-picker";
import { LabelPicker } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { ProjectPicker } from "./project-picker";
import { StatusControl } from "./status-control";

type Draft = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  projectId: string | null;
  dueDate: string;
  labels: TeamLabel[];
};

const emptyDraft: Draft = {
  title: "",
  description: "",
  status: "todo",
  priority: "none",
  assigneeId: null,
  projectId: null,
  dueDate: "",
  labels: [],
};

/**
 * Mounted only while open. It reads the URL to build the link to the task it
 * creates, and the frame that hosts it must stay free of request data, so its
 * lifetime is the open state rather than the frame's.
 */
export function CreateTaskDialog({ closeAction }: { closeAction: () => void }) {
  const { taskHref } = useWorkspaceUrl();
  const router = useRouter();
  const open = true;
  const onOpenChange = (next: boolean) => {
    if (!next) closeAction();
  };
  // The created task opens where a clicked row opens: a push to its route,
  // intercepted into the panel beside the list the action just republished.
  const createAction = (taskId: string) => router.push(taskHref(taskId));

  const createTask = useCreateTask();
  const [isCreating, startCreateTransition] = React.useTransition();
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [formError, setFormError] = React.useState<string | null>(null);

  function patch(values: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function handleOpenChange(next: boolean) {
    // Closing resets the draft; the form is only preserved across failures.
    if (!next) {
      setDraft(emptyDraft);
      setFormError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setFormError("A title is required.");
      return;
    }

    setFormError(null);
    startCreateTransition(async () => {
      try {
        const task = await createTask({
          title,
          description: draft.description.trim() || undefined,
          status: draft.status,
          priority: draft.priority,
          assigneeId: draft.assigneeId,
          projectId: draft.projectId,
          dueDate: draft.dueDate ? fromDateInputValue(draft.dueDate) : null,
          labelIds: draft.labels.map((label) => label.id),
        });

        toast.success("Task created");
        setDraft(emptyDraft);
        onOpenChange(false);
        createAction(task.id);
      } catch (error) {
        // The dialog stays open and the draft is preserved on failure.
        setFormError(
          error instanceof Error ? error.message : "Couldn't create task.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Capture work for the team. Only a title is required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <Input
              autoFocus
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Task title"
              className="h-10 text-base font-medium"
            />
            <Textarea
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Add a description…"
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusControl
              value={draft.status}
              changeAction={(status) => patch({ status })}
            />
            <PriorityControl
              value={draft.priority}
              changeAction={(priority) => patch({ priority })}
            />
            <div className="w-44">
              <AssigneePicker
                value={draft.assigneeId}
                changeAction={(assigneeId) => patch({ assigneeId })}
              />
            </div>
            <div className="w-44">
              <ProjectPicker
                value={draft.projectId}
                changeAction={(projectId) => patch({ projectId })}
              />
            </div>
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(event) => patch({ dueDate: event.target.value })}
              className="h-9 w-40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {draft.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2 pr-1 text-[11px] font-medium text-muted-foreground"
              >
                <span
                  className={cn("size-1.5 rounded-full", accent(label.color).dot)}
                />
                {label.name}
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      labels: draft.labels.filter((item) => item.id !== label.id),
                    })
                  }
                  className="rounded-full p-0.5 text-muted-foreground/70 hover:text-rose"
                  aria-label={`Remove ${label.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <LabelPicker
              selectedIds={draft.labels.map((label) => label.id)}
              addAction={(label) =>
                patch({
                  labels: draft.labels.some((item) => item.id === label.id)
                    ? draft.labels
                    : [...draft.labels, label],
                })
              }
              removeAction={(labelId) =>
                patch({
                  labels: draft.labels.filter((item) => item.id !== labelId),
                })
              }
            />
          </div>

          {formError ? (
            <p className="flex items-center gap-2 rounded-md border border-rose/30 bg-rose/5 px-3 py-2 text-sm text-rose">
              <AlertTriangle className="size-4 shrink-0" />
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
