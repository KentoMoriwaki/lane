"use client";

import type { Insights } from "@/server/api";
import { useLinkStatus } from "next/link";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { accent, type AccentToken } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { IntentPrefetchLink } from "./intent-prefetch-link";

type InsightCard = {
  key: string;
  label: string;
  value: number;
  tone: AccentToken;
  view: Partial<TaskFilters>;
};

export function InsightStrip({
  insights,
  filters,
  viewHref,
}: {
  insights: Insights;
  filters: TaskFilters;
  viewHref: (view: Partial<TaskFilters>) => string;
}) {
  const cards: InsightCard[] = [
    {
      key: "in_progress",
      label: "In progress",
      value: insights.inProgress,
      tone: "amber",
      view: { status: ["in_progress"] },
    },
    {
      key: "in_review",
      label: "In review",
      value: insights.inReview,
      tone: "cobalt",
      view: { status: ["in_review"] },
    },
    {
      key: "overdue",
      label: "Overdue",
      value: insights.overdue,
      tone: "rose",
      view: { due: "overdue" },
    },
    {
      key: "due_soon",
      label: "Due soon",
      value: insights.dueSoon,
      tone: "amber",
      view: { due: "week" },
    },
    {
      key: "unassigned",
      label: "Unassigned",
      value: insights.unassigned,
      tone: "slate",
      view: { scope: "unassigned" },
    },
    {
      key: "completed",
      label: "Completed",
      value: insights.completed,
      tone: "sage",
      view: { status: ["done"] },
    },
  ];

  return (
    <div className="border-b border-border">
      <div className="scrollbar-calm flex items-stretch gap-2 overflow-x-auto px-4 py-3">
        {cards.map((card) => (
          <IntentPrefetchLink
            key={card.key}
            href={viewHref(card.view)}
            scroll={false}
            className="group min-w-[124px] flex-1 rounded-lg"
          >
            <InsightCardContent
              card={card}
              isActive={isInsightViewActive(filters, card.view)}
            />
          </IntentPrefetchLink>
        ))}
        <OpenTrend
          open={insights.open}
          inProgress={insights.inProgress}
          inReview={insights.inReview}
          completed={insights.completed}
        />
      </div>
    </div>
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
  return (
    <span
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition",
        isActive || pending
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

function isInsightViewActive(filters: TaskFilters, view: Partial<TaskFilters>) {
  const target = { ...EMPTY_FILTERS, ...view };
  return (
    filters.scope === target.scope &&
    filters.q === target.q &&
    filters.projectId === target.projectId &&
    filters.labelId === target.labelId &&
    filters.due === target.due &&
    filters.status.join(",") === target.status.join(",") &&
    filters.priority.join(",") === target.priority.join(",")
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
    {
      tone: "slate" as const,
      value: Math.max(open - inProgress - inReview, 0),
    },
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
