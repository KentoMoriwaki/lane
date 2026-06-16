"use client";

import type { Task, TaskStatus } from "@/server/api";
import { Ban, CircleCheck, CircleDot, type LucideIcon } from "lucide-react";
import {
  useBlockedByTasks,
  useBlockingTasks,
} from "@/app/react-query/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
 * reads must meet at one site (you can't split it across mounted children), and
 * why each is a separate `enabled`-gated read rather than a conditional mount.
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
  const hasBlockedBy = task.blockedBy.length > 0;
  const hasBlocks = task.blocks.length > 0;

  // Both hooks always run; `enabled` decides which actually fetch.
  const blockedByQuery = useBlockedByTasks(task.id, task.blockedBy);
  const blockingQuery = useBlockingTasks(task.id, task.blocks);

  if (!hasBlockedBy && !hasBlocks) {
    return null;
  }

  const isLoading =
    (hasBlockedBy && blockedByQuery.isLoading) ||
    (hasBlocks && blockingQuery.isLoading);

  const blockers = blockedByQuery.data ?? [];
  const downstream = blockingQuery.data ?? [];

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dependencies
      </p>

      {isLoading ? (
        <Skeleton className="h-7 w-full" />
      ) : (
        <VerdictChip verdict={computeVerdict(blockers, downstream)} />
      )}

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
    </section>
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
