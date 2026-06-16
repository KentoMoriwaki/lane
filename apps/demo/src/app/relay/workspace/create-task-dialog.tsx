"use client";

import type { TaskPriority, TaskStatus } from "@/server/api";
import { AlertTriangle, Loader2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useCreateTask } from "@/app/relay/api/mutations";
import { useWorkspaceRefresh } from "@/app/relay/api/workspace-refresh";
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
import { AssigneePicker, type PickerMember } from "./assignee-picker";
import { LabelPicker, type PickerLabel } from "./label-picker";
import { PriorityControl } from "./priority-control";
import { ProjectPicker, type PickerProject } from "./project-picker";
import { StatusControl } from "./status-control";

type Draft = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: PickerMember | null;
  project: PickerProject | null;
  dueDate: string;
  labels: PickerLabel[];
};

const emptyDraft: Draft = {
  title: "",
  description: "",
  status: "todo",
  priority: "none",
  assignee: null,
  project: null,
  dueDate: "",
  labels: [],
};

export function CreateTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
  const createTask = useCreateTask();
  const { notifyMutation } = useWorkspaceRefresh();
  const [isCreating, startCreateTransition] = React.useTransition();
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [formError, setFormError] = React.useState<string | null>(null);

  function patch(values: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function handleOpenChange(next: boolean) {
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
        const taskId = await createTask({
          title,
          description: draft.description.trim() || undefined,
          status: draft.status,
          priority: draft.priority,
          assigneeId: draft.assignee?.id ?? null,
          projectId: draft.project?.id ?? null,
          dueDate: draft.dueDate ? fromDateInputValue(draft.dueDate) : null,
          labelIds: draft.labels.map((label) => label.id),
        });

        toast.success("Task created");
        setDraft(emptyDraft);
        onOpenChange(false);
        // A created task isn't in any list result yet, so the list refetches;
        // the counters refresh too.
        notifyMutation("create");
        onCreated(taskId);
      } catch (error) {
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
                value={draft.assignee?.id ?? null}
                selected={draft.assignee}
                changeAction={(assignee) => patch({ assignee })}
              />
            </div>
            <div className="w-44">
              <ProjectPicker
                value={draft.project?.id ?? null}
                selected={draft.project}
                changeAction={(project) => patch({ project })}
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
                  className={cn(
                    "size-1.5 rounded-full",
                    accent(label.color).dot,
                  )}
                />
                {label.name}
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      labels: draft.labels.filter(
                        (item) => item.id !== label.id,
                      ),
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
              {isCreating ? <Loader2 className="size-4 animate-spin" /> : null}
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
