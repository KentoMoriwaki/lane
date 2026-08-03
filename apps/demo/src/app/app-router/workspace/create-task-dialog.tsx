"use client";

import type {
  Project,
  TaskPriority,
  TaskStatus,
  TeamLabel,
  TeamMember,
} from "@/server/api";
import { AlertTriangle, Loader2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { createTaskAction } from "@/app/lane/api/actions";
import { PriorityControl } from "@/app/lane/workspace/priority-control";
import { StatusControl } from "@/app/lane/workspace/status-control";
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
import { ProjectPicker } from "./project-picker";
import type { WorkspaceContext } from "./workspace";

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

export function CreateTaskDialog({
  ctx,
  open,
  members,
  projects,
  labels,
  onOpenChange,
  onCreated,
}: {
  ctx: WorkspaceContext;
  open: boolean;
  members: TeamMember[];
  projects: Project[];
  labels: TeamLabel[];
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
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
        const task = await createTaskAction(ctx, {
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
        onCreated(task.id);
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
                members={members}
                value={draft.assigneeId}
                changeAction={(assigneeId) => patch({ assigneeId })}
              />
            </div>
            <div className="w-44">
              <ProjectPicker
                ctx={ctx}
                projects={projects}
                value={draft.projectId}
                changeAction={(projectId) => patch({ projectId })}
              />
            </div>
            <Input
              type="date"
              aria-label="New task due date"
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
              ctx={ctx}
              labels={labels}
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
              <AlertTriangle className="size-4 shrink-0" /> {formError}
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
