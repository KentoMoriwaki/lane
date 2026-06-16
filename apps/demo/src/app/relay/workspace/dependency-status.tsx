"use client";

import { Ban, CircleCheck, CircleDot, type LucideIcon } from "lucide-react";
import { graphql, useFragment } from "react-relay";
import type { TaskStatus } from "@/server/api";
import { cn } from "@/lib/utils";
import type { dependencyStatus_task$key } from "@/app/relay/__generated__/dependencyStatus_task.graphql";
import { StatusIcon } from "./task-bits";

// `blockedBy` / `blocks` resolve to full Task nodes on the server. This fragment
// is spread with `@defer` in the detail query, so it streams into its own
// Suspense boundary after the rest of the panel is already on screen.
const dependencyFragment = graphql`
  fragment dependencyStatus_task on Task {
    blockedBy {
      id
      title
      status
    }
    blocks {
      id
      title
      status
    }
  }
`;

function isOpen(status: TaskStatus): boolean {
  return status !== "done" && status !== "canceled";
}

type DepTask = { readonly id: string; readonly title: string; readonly status: TaskStatus };

type Verdict = {
  tone: "blocked" | "ready";
  icon: LucideIcon;
  label: string;
};

/**
 * Reads BOTH dependency sets at once — open blockers gate readiness, downstream
 * tasks describe impact. One combined verdict line, which is exactly why the two
 * reads must meet at one site.
 */
function computeVerdict(
  blockers: readonly DepTask[],
  downstream: readonly DepTask[],
): Verdict {
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
  task: taskRef,
  onSelectTask,
}: {
  task: dependencyStatus_task$key;
  onSelectTask: (taskId: string) => void;
}) {
  const { blockedBy, blocks } = useFragment(dependencyFragment, taskRef);

  if (blockedBy.length === 0 && blocks.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dependencies
      </p>
      <div className="space-y-2">
        <VerdictChip verdict={computeVerdict(blockedBy, blocks)} />
        {blockedBy.length > 0 ? (
          <DependencyList
            label="Blocked by"
            tasks={blockedBy}
            onSelectTask={onSelectTask}
          />
        ) : null}
        {blocks.length > 0 ? (
          <DependencyList
            label="Blocking"
            tasks={blocks}
            onSelectTask={onSelectTask}
          />
        ) : null}
      </div>
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
  tasks: readonly DepTask[];
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
