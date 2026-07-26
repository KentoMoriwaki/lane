"use client";

import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { useWorkspaceRefresh } from "@/app/lane/api/hooks";
import { queryKeys } from "@/app/lane/api/query-options";
import { buildWorkspaceHref } from "@/app/lane/api/url-state";
import { useLaneInstance } from "use-lane";
import { CreateTaskDialog } from "./create-task-dialog";
import { SectionError } from "./feedback";
import { FilterBar } from "./filter-bar";
import { InsightStrip, InsightStripSkeleton } from "./insight-strip";
import { LaneErrorBoundary } from "./lane-error-boundary";
import { Sidebar } from "./sidebar";
import { SignInScreen } from "./sign-in-screen";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskList, TaskListSkeleton } from "./task-list";
import { Topbar } from "./topbar";
import { useDebouncedSearchField } from "./use-debounced-search-field";
import { useWorkspaceUrl } from "./use-workspace-url";
import { useWorkspace } from "./workspace-provider";

export function Workspace() {
  const { isSignedIn } = useWorkspace();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const {
    pathname,
    state: urlState,
    filters,
    selectedTaskId,
    patchFilters,
    resetFilters,
    selectTask,
    isPending: isViewPending,
  } = useWorkspaceUrl();
  const [createOpen, setCreateOpen] = React.useState(false);
  const lane = useLaneInstance();
  const { refresh, isRefreshing } = useWorkspaceRefresh();

  const commitSearch = React.useCallback(
    (q: string) => patchFilters({ q }, "replace"),
    [patchFilters],
  );
  const searchField = useDebouncedSearchField(filters.q, commitSearch);

  const viewHref = React.useCallback(
    (view: Partial<TaskFilters>) =>
      buildWorkspaceHref(pathname, urlState, {
        filters: { ...EMPTY_FILTERS, ...view },
      }),
    [pathname, urlState],
  );
  const filterHref = React.useCallback(
    (nextFilters: TaskFilters) =>
      buildWorkspaceHref(pathname, urlState, {
        filters: nextFilters,
      }),
    [pathname, urlState],
  );
  const resetFiltersHref = React.useMemo(
    () =>
      buildWorkspaceHref(pathname, urlState, {
        filters: { ...EMPTY_FILTERS },
      }),
    [pathname, urlState],
  );

  const hasActiveFilters =
    filters.scope !== "all" ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    Boolean(filters.projectId) ||
    Boolean(filters.labelId) ||
    Boolean(filters.due) ||
    filters.q.trim().length > 0;

  const clearSelectionFor = React.useCallback(
    (taskId: string) => {
      if (selectedTaskId === taskId) {
        selectTask(null);
      }
    },
    [selectedTaskId, selectTask],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <LaneErrorBoundary
        resetKey={`sidebar:${filters.projectId ?? ""}:${filters.labelId ?? ""}`}
        fallback={(error, retry) => (
          <SidebarError
            error={error}
            onRetry={() => {
              lane.invalidate(queryKeys.currentUser);
              lane.invalidate(queryKeys.teams);
              lane.invalidate(queryKeys.insights);
              lane.invalidate(queryKeys.projects);
              lane.invalidate(queryKeys.labels);
              retry();
            }}
          />
        )}
      >
        <React.Suspense fallback={<SidebarSkeleton />}>
          <Sidebar filters={filters} viewHref={viewHref} />
        </React.Suspense>
      </LaneErrorBoundary>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          searchField={searchField}
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing || isViewPending}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <LaneErrorBoundary
              resetKey="insights"
              fallback={(error, retry) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Insights unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={() => {
                      lane.invalidate(queryKeys.insights);
                      retry();
                    }}
                  />
                </div>
              )}
            >
              <React.Suspense fallback={<InsightStripSkeleton />}>
                <InsightStrip filters={filters} viewHref={viewHref} />
              </React.Suspense>
            </LaneErrorBoundary>
            <LaneErrorBoundary
              resetKey={`filters:${JSON.stringify(filters)}`}
              fallback={(error, retry) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Filters unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={() => {
                      lane.invalidate(queryKeys.projects);
                      lane.invalidate(queryKeys.labels);
                      lane.invalidate(queryKeys.tasks(filters));
                      retry();
                    }}
                  />
                </div>
              )}
            >
              <React.Suspense fallback={<FilterBarSkeleton />}>
                <FilterBar
                  filters={filters}
                  filterHref={filterHref}
                  resetHref={resetFiltersHref}
                />
              </React.Suspense>
            </LaneErrorBoundary>
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <LaneErrorBoundary
                resetKey={`tasks:${JSON.stringify(filters)}`}
                fallback={(error, retry) => (
                  <div className="p-4">
                    <SectionError
                      title="Couldn't load tasks"
                      message={
                        error instanceof Error ? error.message : undefined
                      }
                      onRetry={() => {
                        lane.invalidate(queryKeys.tasks(filters));
                        retry();
                      }}
                    />
                  </div>
                )}
              >
                <React.Suspense fallback={<TaskListSkeleton />}>
                  <TaskList
                    filters={filters}
                    hasActiveFilters={hasActiveFilters}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={selectTask}
                    onClearSelection={clearSelectionFor}
                    onResetFilters={resetFilters}
                  />
                </React.Suspense>
              </LaneErrorBoundary>
            </div>
          </section>

          <LaneErrorBoundary
            resetKey={`task:${selectedTaskId ?? ""}`}
            fallback={(error, retry) => (
              <TaskDetailError
                error={error}
                onClose={() => selectTask(null)}
                onRetry={() => {
                  if (selectedTaskId) {
                    lane.invalidate(queryKeys.task(selectedTaskId));
                  }
                  retry();
                }}
              />
            )}
          >
            <TaskDetailPanel
              taskId={selectedTaskId}
              onClose={() => selectTask(null)}
            />
          </LaneErrorBoundary>
        </div>
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={selectTask}
      />
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:block" />
  );
}

function FilterBarSkeleton() {
  return <div className="h-[49px] border-b border-border" />;
}

function SidebarError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar p-3 md:block">
      <SectionError
        title="Workspace unavailable"
        message={error instanceof Error ? error.message : undefined}
        onRetry={onRetry}
      />
    </aside>
  );
}

function TaskDetailError({
  error,
  onClose,
  onRetry,
}: {
  error: unknown;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <aside className="scrollbar-calm hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface p-4 lg:block">
      <SectionError
        title="Couldn't load this task"
        message={error instanceof Error ? error.message : undefined}
        onRetry={onRetry}
      />
      <button
        type="button"
        onClick={onClose}
        className="mt-3 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Close panel
      </button>
    </aside>
  );
}
