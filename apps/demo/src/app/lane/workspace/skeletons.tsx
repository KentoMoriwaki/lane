import type * as React from "react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The workspace, drawn once, with nothing in it yet.
 *
 * Every loading surface in both server-owned routes comes from here. That is
 * the point: a fallback is not a decoration next to the real component, it is
 * what the framework prerenders *at that component's position*, so the two have
 * to describe the same box. Kept in separate files they drift — and they did,
 * in every region, until this module replaced them.
 *
 * Each region skeleton renders the same outer element as the component it
 * stands in for, so it can be used either as a `<Suspense>` fallback around
 * that component or as one tile of `<WorkspaceSkeleton>`, and the frame does
 * not move when the real thing arrives.
 */

export function SidebarSkeleton({ brand }: { brand?: React.ReactNode }) {
  return (
    <aside data-testid="sidebar-skeleton" className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 px-4">{brand}</div>
      <div className="px-3 pb-2">
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="space-y-5 px-3 py-3">
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function ProjectHeaderSkeleton() {
  return (
    <div className="flex min-h-[92px] items-center gap-3 border-b border-border bg-surface px-4 py-4">
      <Skeleton className="size-10 rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="ml-auto h-8 w-20" />
    </div>
  );
}

export function TopbarSkeleton() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      {/* The search field is an input, not data — it renders at its real size
          rather than pulsing, so the topbar does not reflow on arrival. */}
      <div className="h-9 w-full max-w-md rounded-md border border-input bg-background/60" />
      <Skeleton className="ml-auto h-9 w-9 shrink-0" />
      <Skeleton className="h-9 w-24 shrink-0" />
    </header>
  );
}

/** Kept for the App Router comparison, which still renders its insight strip. */
export function InsightStripSkeleton() {
  return (
    <div className="border-b border-border">
      <div className="scrollbar-calm flex items-stretch gap-2 overflow-x-auto px-4 py-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[58px] w-32 shrink-0 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function FilterBarSkeleton() {
  return (
    <div className="flex h-[49px] items-center gap-2 border-b border-border px-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="ml-auto h-3 w-14" />
    </div>
  );
}

export function TaskListSkeleton() {
  return (
    <div data-testid="task-list-skeleton" className="px-4 py-3">
      <Skeleton className="mb-3 h-3 w-24 bg-muted-foreground/20" />
      <div className="space-y-3">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-4 rounded-full bg-muted-foreground/20" />
            <Skeleton className="size-4 rounded-full bg-muted-foreground/20" />
            <Skeleton
              className="h-4 flex-1 bg-muted-foreground/20"
              style={{ maxWidth: `${60 - index * 4}%` }}
            />
            <Skeleton className="h-4 w-12 bg-muted-foreground/20" />
            <Skeleton className="size-6 rounded-full bg-muted-foreground/20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-5 p-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-20 w-full" />
      <Separator />
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[88px_1fr] items-center gap-3"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function DetailPanelSkeleton() {
  return (
    <aside
      data-testid="task-panel-skeleton"
      className="scrollbar-calm hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface lg:block"
    >
      <DetailSkeleton />
    </aside>
  );
}

/**
 * The whole workspace as one fallback: the frame both routes render, with every
 * region in its empty state.
 *
 * It carries no request or URL data, so Cache Components can reuse it as the
 * route's App Shell for any link into it.
 */
export function WorkspaceSkeleton({
  brand,
  testId,
  label,
}: {
  brand: React.ReactNode;
  testId: string;
  label: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-label={label}
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <SidebarSkeleton brand={brand} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarSkeleton />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <InsightStripSkeleton />
            <FilterBarSkeleton />
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <TaskListSkeleton />
            </div>
          </section>

          <DetailPanelSkeleton />
        </div>
      </div>
    </div>
  );
}
