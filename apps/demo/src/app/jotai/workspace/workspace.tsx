"use client";

import { useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import {
  currentUserAtom,
  filtersAtom,
  insightsAtom,
  isSignedInAtom,
  labelsAtom,
  patchFiltersAtom,
  projectsAtom,
  resetFiltersAtom,
  selectedTaskIdAtom,
  tasksAtomFamily,
  teamsAtom,
} from "@/app/jotai/api/atoms";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/jotai/api/endpoints";
import {
  useRefreshQuery,
  useRefreshSelectedTask,
  useWorkspaceRefresh,
} from "@/app/jotai/api/hooks";
import { useWorkspaceTransition } from "@/app/jotai/api/workspace-transition";
import { CreateTaskDialog } from "./create-task-dialog";
import { QueryErrorBoundary } from "./error-boundary";
import { SectionError } from "./feedback";
import { FilterBar } from "./filter-bar";
import { InsightStrip, InsightStripSkeleton } from "./insight-strip";
import { Sidebar } from "./sidebar";
import { SignInScreen } from "./sign-in-screen";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskList, TaskListSkeleton } from "./task-list";
import { Topbar } from "./topbar";
import { useDebouncedSearchField } from "./use-debounced-search-field";

export function Workspace() {
  const isSignedIn = useAtomValue(isSignedInAtom);

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const filters = useAtomValue(filtersAtom);
  const selectedTaskId = useAtomValue(selectedTaskIdAtom);
  const view = useWorkspaceView();
  const [createOpen, setCreateOpen] = React.useState(false);
  const { refresh, isRefreshing } = useWorkspaceRefresh();
  const refreshQuery = useRefreshQuery();
  const refreshSelectedTask = useRefreshSelectedTask();

  const commitSearch = React.useCallback(
    (q: string) => view.patchFilters({ q }),
    [view],
  );
  const searchField = useDebouncedSearchField(filters.q, commitSearch);

  const selectView = React.useCallback(
    (nextView: Partial<TaskFilters>) =>
      view.setFilters({ ...EMPTY_FILTERS, ...nextView }),
    [view],
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
        view.selectTask(null);
      }
    },
    [selectedTaskId, view],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <QueryErrorBoundary
        resetKey={`sidebar:${filters.projectId ?? ""}:${filters.labelId ?? ""}`}
        fallback={(error, retry) => (
          <SidebarError
            error={error}
            onRetry={() => {
              refreshQuery(currentUserAtom);
              refreshQuery(teamsAtom);
              refreshQuery(insightsAtom);
              refreshQuery(projectsAtom);
              refreshQuery(labelsAtom);
              retry();
            }}
          />
        )}
      >
        <React.Suspense fallback={<SidebarSkeleton />}>
          <Sidebar filters={filters} onViewChange={selectView} />
        </React.Suspense>
      </QueryErrorBoundary>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          searchField={searchField}
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <QueryErrorBoundary
              resetKey="insights"
              fallback={(error, retry) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Insights unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={() => {
                      refreshQuery(insightsAtom);
                      retry();
                    }}
                  />
                </div>
              )}
            >
              <React.Suspense fallback={<InsightStripSkeleton />}>
                <InsightStrip filters={filters} onViewChange={selectView} />
              </React.Suspense>
            </QueryErrorBoundary>
            <QueryErrorBoundary
              resetKey={`filters:${JSON.stringify(filters)}`}
              fallback={(error, retry) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Filters unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={() => {
                      refreshQuery(projectsAtom);
                      refreshQuery(labelsAtom);
                      refreshQuery(tasksAtomFamily(filters));
                      retry();
                    }}
                  />
                </div>
              )}
            >
              <React.Suspense fallback={<FilterBarSkeleton />}>
                <FilterBar
                  filters={filters}
                  onFilterChange={view.setFilters}
                  onResetFilters={view.resetFilters}
                />
              </React.Suspense>
            </QueryErrorBoundary>
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <QueryErrorBoundary
                resetKey={`tasks:${JSON.stringify(filters)}`}
                fallback={(error, retry) => (
                  <div className="p-4">
                    <SectionError
                      title="Couldn't load tasks"
                      message={
                        error instanceof Error ? error.message : undefined
                      }
                      onRetry={() => {
                        refreshQuery(tasksAtomFamily(filters));
                        retry();
                      }}
                    />
                  </div>
                )}
              >
                <React.Suspense fallback={<TaskListSkeleton />}>
                  <TaskList
                    hasActiveFilters={hasActiveFilters}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={view.selectTask}
                    onClearSelection={clearSelectionFor}
                    onResetFilters={view.resetFilters}
                  />
                </React.Suspense>
              </QueryErrorBoundary>
            </div>
          </section>

          <QueryErrorBoundary
            resetKey={`task:${selectedTaskId ?? ""}`}
            fallback={(error, retry) => (
              <TaskDetailError
                error={error}
                onClose={() => view.selectTask(null)}
                onRetry={() => {
                  refreshSelectedTask();
                  retry();
                }}
              />
            )}
          >
            <TaskDetailPanel
              onClose={() => view.selectTask(null)}
              onSelectTask={view.selectTask}
            />
          </QueryErrorBoundary>
        </div>
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={view.selectTask}
      />
    </div>
  );
}

type WorkspaceViewController = {
  patchFilters: (patch: Partial<TaskFilters>) => void;
  setFilters: (filters: TaskFilters) => void;
  resetFilters: () => void;
  selectTask: (taskId: string | null) => void;
};

/**
 * Filters and the selected task are atoms too, so the view and the reads that
 * depend on it are one graph: writing `filtersAtom` is what addresses the next
 * task list. Every write goes through the shared transition, which is what
 * keeps the current list on screen while that read resolves.
 */
function useWorkspaceView(): WorkspaceViewController {
  const { startTransition } = useWorkspaceTransition();
  const setFiltersState = useSetAtom(filtersAtom);
  const patchFiltersState = useSetAtom(patchFiltersAtom);
  const resetFiltersState = useSetAtom(resetFiltersAtom);
  const setSelectedTaskId = useSetAtom(selectedTaskIdAtom);

  return React.useMemo(
    () => ({
      patchFilters: (patch) => startTransition(() => patchFiltersState(patch)),
      resetFilters: () => startTransition(() => resetFiltersState()),
      selectTask: (taskId) => startTransition(() => setSelectedTaskId(taskId)),
      setFilters: (filters) => startTransition(() => setFiltersState(filters)),
    }),
    [
      patchFiltersState,
      resetFiltersState,
      setFiltersState,
      setSelectedTaskId,
      startTransition,
    ],
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
