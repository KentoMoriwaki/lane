"use client";

import type { Task, TaskStatus } from "@/server/api";
import { Ban, CircleCheck, CircleDot, type LucideIcon } from "lucide-react";
import * as React from "react";
import {
  useBlockedByTasks,
  useBlockingTasks,
  useRefreshTaskDependencies,
} from "@/app/jotai/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { QueryErrorBoundary } from "./error-boundary";
import { StatusIcon } from "./task-bits";

function isOpen(status: TaskStatus): boolean {
  return status !== "done" && status !== "canceled";
}

type Verdict = {
  tone: "blocked" | "ready";
  icon: LucideIcon;
  label: string;
};

/**
 * The verdict reads BOTH dependency sets at once — open blockers gate readiness,
 * downstream tasks describe impact. That single computed line is why the two
 * reads must meet at one site (a conditional mount cannot produce it).
 */
function computeVerdict(blockers: Task[], downstream: Task[]): Verdict {
  const openBlockers = blockers.filter((task) => isOpen(task.status));

  if (openBlockers.length > 0) {
    return {
      tone: "blocked",
      icon: Ban,
      label: `Blocked — ${openBlockers.length} of ${blockers.length} ${
        blockers.length === 1 ? "blocker" : "blockers"
      } still open`,
    };
  }

  const openDownstream = downstream.filter((task) => isOpen(task.status));
  if (openDownstream.length > 0) {
    return {
      tone: "ready",
      icon: CircleDot,
      label: `Ready — unblocks ${openDownstream.length} ${
        openDownstream.length === 1 ? "task" : "tasks"
      }`,
    };
  }

  return {
    tone: "ready",
    icon: CircleCheck,
    label: blockers.length > 0 ? "Ready — all blockers done" : "Ready to pick up",
  };
}

export function DependencyStatus({
  task,
  onSelectTask,
}: {
  task: Task;
  onSelectTask: (taskId: string) => void;
}) {
  const refreshDependencies = useRefreshTaskDependencies(task.id);

  if (task.blockedBy.length === 0 && task.blocks.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dependencies
      </p>
      <QueryErrorBoundary
        resetKey={`deps:${task.id}`}
        fallback={(_error, retry) => (
          <button
            type="button"
            onClick={() => {
              refreshDependencies();
              retry();
            }}
            className="text-xs text-rose hover:underline"
          >
            Couldn&apos;t load dependencies — retry
          </button>
        )}
      >
        <React.Suspense fallback={<Skeleton className="h-7 w-full" />}>
          <DependencyBody taskId={task.id} onSelectTask={onSelectTask} />
        </React.Suspense>
      </QueryErrorBoundary>
    </section>
  );
}

function DependencyBody({
  taskId,
  onSelectTask,
}: {
  taskId: string;
  onSelectTask: (taskId: string) => void;
}) {
  // Neither read takes the edge ids: each derives them from the task's own
  // atom. A task with no blockers resolves to an empty list without a request,
  // so the gating that other variants spell out with `enabled` (or by passing
  // no loader at all) is just what the derivation already says.
  const blockers = useBlockedByTasks(taskId);
  const downstream = useBlockingTasks(taskId);

  return (
    <div className="space-y-2">
      <VerdictChip verdict={computeVerdict(blockers, downstream)} />

      {blockers.length > 0 ? (
        <DependencyList
          label="Blocked by"
          tasks={blockers}
          onSelectTask={onSelectTask}
        />
      ) : null}

      {downstream.length > 0 ? (
        <DependencyList
          label="Blocking"
          tasks={downstream}
          onSelectTask={onSelectTask}
        />
      ) : null}
    </div>
  );
}

const toneClasses: Record<Verdict["tone"], string> = {
  blocked: "border-rose/30 bg-rose/5 text-rose",
  ready: "border-sage/30 bg-sage/10 text-sage",
};

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const Icon = verdict.icon;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium",
        toneClasses[verdict.tone],
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span>{verdict.label}</span>
    </div>
  );
}

function DependencyList({
  label,
  tasks,
  onSelectTask,
}: {
  label: string;
  tasks: Task[];
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      <ul className="space-y-0.5">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onSelectTask(task.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
            >
              <StatusIcon status={task.status} className="shrink-0" />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] text-foreground",
                  !isOpen(task.status) &&
                    "text-muted-foreground line-through decoration-1",
                )}
              >
                {task.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
