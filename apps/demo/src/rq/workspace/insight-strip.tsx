"use client";

import type { TaskFilters } from "@/rq/api/endpoints";
import { useInsights } from "@/rq/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { accent, type AccentToken } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { SectionError } from "./feedback";

type InsightCard = {
  key: string;
  label: string;
  value: number;
  tone: AccentToken;
  view: Partial<TaskFilters>;
};

export function InsightStrip({
  onApplyView,
}: {
  onApplyView: (view: Partial<TaskFilters>) => void;
}) {
  const { data, isPending, isError, refetch, isFetching } = useInsights();

  if (isError) {
    return (
      <div className="border-b border-border px-4 py-3">
        <SectionError
          title="Insights unavailable"
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex gap-2 overflow-hidden border-b border-border px-4 py-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[58px] w-32 shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }

  const cards: InsightCard[] = [
    { key: "in_progress", label: "In progress", value: data.inProgress, tone: "amber", view: { status: ["in_progress"] } },
    { key: "in_review", label: "In review", value: data.inReview, tone: "cobalt", view: { status: ["in_review"] } },
    { key: "overdue", label: "Overdue", value: data.overdue, tone: "rose", view: { due: "overdue" } },
    { key: "due_soon", label: "Due soon", value: data.dueSoon, tone: "amber", view: { due: "week" } },
    { key: "unassigned", label: "Unassigned", value: data.unassigned, tone: "slate", view: { scope: "unassigned" } },
    { key: "completed", label: "Completed", value: data.completed, tone: "sage", view: { status: ["done"] } },
  ];

  return (
    <div className="scrollbar-calm flex items-stretch gap-2 overflow-x-auto border-b border-border px-4 py-3">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={() => onApplyView(card.view)}
          className="group flex min-w-[124px] flex-1 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-accent/50"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className={cn("size-2 rounded-full", accent(card.tone).dot)} />
            {card.label}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {card.value}
          </span>
        </button>
      ))}
      <OpenTrend
        open={data.open}
        inProgress={data.inProgress}
        inReview={data.inReview}
        completed={data.completed}
      />
    </div>
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
