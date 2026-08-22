"use client";

import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { useInsights } from "@/app/lane/api/hooks";
import { accent, type AccentToken } from "@/lib/accent";
import { cn } from "@/lib/utils";
import Link, { useLinkStatus } from "next/link";
import { useWorkspaceHrefs } from "./use-workspace-hrefs";
import * as React from "react";

type InsightCard = {
  key: string;
  label: string;
  value: number;
  tone: AccentToken;
  view: Partial<TaskFilters>;
};

export function InsightStrip() {
  const { filters, viewHref } = useWorkspaceHrefs();
  const { promise, isInvalidationPending } = useInsights();
  const { data } = React.use(promise);

  const cards: InsightCard[] = [
    { key: "in_progress", label: "In progress", value: data.inProgress, tone: "amber", view: { status: ["in_progress"] } },
    { key: "in_review", label: "In review", value: data.inReview, tone: "cobalt", view: { status: ["in_review"] } },
    { key: "overdue", label: "Overdue", value: data.overdue, tone: "rose", view: { due: "overdue" } },
    { key: "due_soon", label: "Due soon", value: data.dueSoon, tone: "amber", view: { due: "week" } },
    { key: "unassigned", label: "Unassigned", value: data.unassigned, tone: "slate", view: { scope: "unassigned" } },
    { key: "completed", label: "Completed", value: data.completed, tone: "sage", view: { status: ["done"] } },
  ];

  return (
    <div className="border-b border-border">
      {/* No chip here. A refresh that never reached the owner is reported once,
          beside the list. What this strip does show is its own convergence:
          these counters are the key a task mutation marks stale, so they are
          the numbers that are briefly behind the row the user just edited, and
          they dim until the publication that recomputes them arrives. */}
      <div
        className="scrollbar-calm flex items-stretch gap-2 overflow-x-auto px-4 py-3 transition-opacity"
        style={{ opacity: isInvalidationPending ? 0.6 : 1 }}
      >
        {cards.map((card) => (
          <InsightCardButton
            key={card.key}
            card={card}
            href={viewHref(card.view)}
            isActive={isInsightViewActive(filters, card.view)}
          />
        ))}
        <OpenTrend
          open={data.open}
          inProgress={data.inProgress}
          inReview={data.inReview}
          completed={data.completed}
        />
      </div>
    </div>
  );
}

function InsightCardButton({
  card,
  href,
  isActive,
}: {
  card: InsightCard;
  href: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className="group min-w-[124px] flex-1 rounded-lg"
    >
      <InsightCardContent card={card} isActive={isActive} />
    </Link>
  );
}

function InsightCardContent({
  card,
  isActive,
}: {
  card: InsightCard;
  isActive: boolean;
}) {
  const { pending } = useLinkStatus();
  const active = isActive || pending;

  return (
    <span
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition",
        active
          ? "border-foreground/20 bg-accent/65"
          : "border-border bg-surface group-hover:border-foreground/20 group-hover:bg-accent/50",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={cn("size-2 rounded-full", accent(card.tone).dot)} />
        {card.label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">
        {card.value}
      </span>
    </span>
  );
}

function isInsightViewActive(
  filters: TaskFilters,
  view: Partial<TaskFilters>,
): boolean {
  const target = { ...EMPTY_FILTERS, ...view };
  return (
    filters.scope === target.scope &&
    filters.q === target.q &&
    filters.projectId === target.projectId &&
    filters.labelId === target.labelId &&
    filters.due === target.due &&
    sameValues(filters.status, target.status) &&
    sameValues(filters.priority, target.priority)
  );
}

function sameValues<T>(left: T[], right: T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function OpenTrend({
  open,
  inProgress,
  inReview,
  completed,
}: {
  open: number;
  inProgress: number;
  inReview: number;
  completed: number;
}) {
  const bars = [
    { tone: "slate" as const, value: Math.max(open - inProgress - inReview, 0) },
    { tone: "amber" as const, value: inProgress },
    { tone: "cobalt" as const, value: inReview },
    { tone: "sage" as const, value: completed },
  ];
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <div className="hidden min-w-[150px] flex-col justify-between rounded-lg border border-border bg-surface px-3 py-2 xl:flex">
      <span className="text-xs font-medium text-muted-foreground">
        Workload
      </span>
      <div className="flex h-9 items-end gap-1.5">
        {bars.map((bar, index) => (
          <div
            key={index}
            className={cn("w-full rounded-sm", accent(bar.tone).dot)}
            style={{ height: `${Math.max(12, (bar.value / max) * 100)}%` }}
            title={`${bar.value}`}
          />
        ))}
      </div>
    </div>
  );
}
