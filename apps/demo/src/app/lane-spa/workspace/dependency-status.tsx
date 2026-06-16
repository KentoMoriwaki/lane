"use client";

import type { Task, TaskStatus } from "@/server/api";
import { Ban, CircleCheck, CircleDot, type LucideIcon } from "lucide-react";
import { useLaneInstance } from "use-lane";
import * as React from "react";
import {
  useBlockedByTasks,
  useBlockingTasks,
} from "@/app/lane-spa/api/hooks";
import { queryKeys } from "@/app/lane-spa/api/query-options";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LaneErrorBoundary } from "./lane-error-boundary";
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
 * gated reads must meet at one site (a conditional mount cannot produce it).
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
  const lane = useLaneInstance();

  if (task.blockedBy.length === 0 && task.blocks.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dependencies
      </p>
      <LaneErrorBoundary
        resetKey={`deps:${task.id}`}
        fallback={(_error, retry) => (
          <button
            type="button"
            onClick={() => {
              lane.invalidate(queryKeys.taskBlockedBy(task.id));
              lane.invalidate(queryKeys.taskBlocking(task.id));
              retry();
            }}
            className="text-xs text-rose hover:underline"
          >
            Couldn&apos;t load dependencies — retry
          </button>
        )}
      >
        <React.Suspense fallback={<Skeleton className="h-7 w-full" />}>
          <DependencyBody task={task} onSelectTask={onSelectTask} />
        </React.Suspense>
      </LaneErrorBoundary>
    </section>
  );
}

function DependencyBody({
  task,
  onSelectTask,
}: {
  task: Task;
  onSelectTask: (taskId: string) => void;
}) {
  const blockedBy = useBlockedByTasks(task.id, task.blockedBy);
  const blocking = useBlockingTasks(task.id, task.blocks);

  // `promise` is `undefined` when the edge does not exist (the gated read is
  // disabled); `use` runs only when there is a promise.
  const blockers = blockedBy.promise ? React.use(blockedBy.promise) : [];
  const downstream = blocking.promise ? React.use(blocking.promise) : [];

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
