"use client";

import * as React from "react";
import {
  graphql,
  useLazyLoadQuery,
  useQueryLoader,
} from "react-relay";
import {
  EMPTY_FILTERS,
  type TaskFilters,
  toGraphQLFilters,
} from "@/app/relay/api/filters";
import { useWorkspace } from "@/app/relay/api/workspace-provider";
import {
  type MutationKind,
  type WorkspaceRefresh,
  WorkspaceRefreshProvider,
  useWorkspaceRefresh,
} from "@/app/relay/api/workspace-refresh";
import type { RelayShellQuery } from "@/app/relay/__generated__/RelayShellQuery.graphql";
import type { RelayTasksQuery } from "@/app/relay/__generated__/RelayTasksQuery.graphql";
import type { RelayTaskDetailQuery } from "@/app/relay/__generated__/RelayTaskDetailQuery.graphql";
import { CreateTaskDialog } from "./create-task-dialog";
import { SectionError } from "./feedback";
import { FilterBar, FilterBarSkeleton } from "./filter-bar";
import { InsightStrip, InsightStripSkeleton } from "./insight-strip";
import { RelayErrorBoundary } from "./relay-error-boundary";
import { Sidebar } from "./sidebar";
import { taskDetailQuery, TaskDetailPanel } from "./task-detail-panel";
import { TaskList, TaskListSkeleton } from "./task-list";
import { Topbar } from "./topbar";
import { useDebouncedSearchField } from "./use-debounced-search-field";

const shellQuery = graphql`
  query RelayShellQuery {
    viewer {
      id
      userId
      name
      email
      initials
      color
      defaultTeamId
      ...sidebarUser_viewer
    }
    ...teamSwitcher_query
    ...sidebarNav_query @defer
    ...filterBar_query @defer
    ...insightStrip_insights @defer
  }
`;

const tasksQuery = graphql`
  query RelayTasksQuery($filters: TaskFilterInput) {
    tasks(filters: $filters) {
      id
      priority
      ...taskRow_task
    }
  }
`;

export function RelayWorkspace() {
  const data = useLazyLoadQuery<RelayShellQuery>(shellQuery, {});
  const { setSessionUser } = useWorkspace();
  const viewer = data.viewer;

  // Keep the session identity available to the sign-in screen after the store
  // is cleared on sign-out.
  React.useEffect(() => {
    setSessionUser({
      id: viewer.userId,
      name: viewer.name,
      email: viewer.email,
      initials: viewer.initials,
      color: viewer.color,
      defaultTeamId: viewer.defaultTeamId,
    });
  }, [setSessionUser, viewer]);

  return <WorkspaceShell shell={data} currentUserId={viewer.userId} />;
}

function WorkspaceShell({
  shell,
  currentUserId,
}: {
  shell: RelayShellQuery["response"];
  currentUserId: string;
}) {
  const [filters, setFilters] = React.useState<TaskFilters>(EMPTY_FILTERS);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    null,
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const [isViewPending, startView] = React.useTransition();
  const [detailRef, loadDetail, disposeDetail] =
    useQueryLoader<RelayTaskDetailQuery>(taskDetailQuery);
  const [insightsKey, setInsightsKey] = React.useState(0);
  const [tasksKey, setTasksKey] = React.useState(0);

  const hasActiveFilters =
    filters.scope !== "all" ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    Boolean(filters.projectId) ||
    Boolean(filters.labelId) ||
    Boolean(filters.due) ||
    filters.q.trim().length > 0;

  // Every view change is a transition: the current screen stays live while the
  // next query (tasks for new filters, the selected task's detail) loads.
  const applyFilters = React.useCallback(
    (next: TaskFilters) => {
      startView(() => setFilters(next));
    },
    [],
  );
  const applyView = React.useCallback(
    (view: Partial<TaskFilters>) => {
      applyFilters({ ...EMPTY_FILTERS, ...view });
    },
    [applyFilters],
  );
  // The search commit lands a few hundred milliseconds after the keystroke that
  // scheduled it, so it patches whatever the filters are by then rather than
  // replacing them with a set captured when the user was still typing.
  const commitSearch = React.useCallback((q: string) => {
    startView(() => setFilters((current) => ({ ...current, q })));
  }, []);
  const searchField = useDebouncedSearchField(filters.q, commitSearch);
  const selectTask = React.useCallback(
    (taskId: string | null) => {
      startView(() => {
        setSelectedTaskId(taskId);
        if (taskId) {
          loadDetail({ id: taskId });
        } else {
          disposeDetail();
        }
      });
    },
    [loadDetail, disposeDetail],
  );
  const clearSelectionFor = React.useCallback(
    (taskId: string) => {
      if (selectedTaskId === taskId) {
        selectTask(null);
      }
    },
    [selectedTaskId, selectTask],
  );

  // A mutation reports what it did; only the reads the store can't reconcile
  // revalidate. An in-place edit lets the normalized store update the rows; the
  // list only refetches if a filter is narrowing it (membership might change).
  const notifyMutation = React.useCallback(
    (kind: MutationKind) => {
      setInsightsKey((key) => key + 1);
      if (kind === "create" || (kind === "edit" && hasActiveFilters)) {
        setTasksKey((key) => key + 1);
      }
    },
    [hasActiveFilters],
  );
  const refreshAll = React.useCallback(() => {
    setInsightsKey((key) => key + 1);
    setTasksKey((key) => key + 1);
  }, []);
  const refresh = React.useCallback(() => {
    startView(() => refreshAll());
  }, [refreshAll]);

  const refreshValue = React.useMemo<WorkspaceRefresh>(
    () => ({ insightsKey, tasksKey, notifyMutation, refreshAll }),
    [insightsKey, tasksKey, notifyMutation, refreshAll],
  );

  return (
    <WorkspaceRefreshProvider value={refreshValue}>
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <RelayErrorBoundary
        resetKey={`sidebar:${filters.projectId ?? ""}:${filters.labelId ?? ""}`}
        fallback={(error) => <SidebarError error={error} />}
      >
        <Sidebar query={shell} filters={filters} onViewChange={applyView} />
      </RelayErrorBoundary>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          searchField={searchField}
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isViewPending}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <RelayErrorBoundary
              resetKey="insights"
              fallback={(error, retry) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Insights unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={retry}
                  />
                </div>
              )}
            >
              <React.Suspense fallback={<InsightStripSkeleton />}>
                <InsightStrip
                  queryRef={shell}
                  filters={filters}
                  onViewChange={applyView}
                />
              </React.Suspense>
            </RelayErrorBoundary>

            <RelayErrorBoundary
              resetKey={`tasks:${JSON.stringify(filters)}`}
              fallback={(error, retry) => (
                <div className="p-4">
                  <SectionError
                    title="Couldn't load tasks"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={retry}
                  />
                </div>
              )}
            >
              <React.Suspense
                fallback={
                  <>
                    <FilterBarSkeleton />
                    <TaskListSkeleton />
                  </>
                }
              >
                <TasksPane
                  query={shell}
                  filters={filters}
                  isPending={isViewPending}
                  currentUserId={currentUserId}
                  hasActiveFilters={hasActiveFilters}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={selectTask}
                  onClearSelection={clearSelectionFor}
                  onResetFilters={() => applyFilters({ ...EMPTY_FILTERS })}
                  onFilterChange={applyFilters}
                />
              </React.Suspense>
            </RelayErrorBoundary>
          </section>

          <RelayErrorBoundary
            resetKey={`task:${selectedTaskId ?? ""}`}
            fallback={(error) => (
              <TaskDetailError error={error} onClose={() => selectTask(null)} />
            )}
          >
            <TaskDetailPanel
              queryRef={detailRef ?? null}
              taskId={selectedTaskId}
              onClose={() => selectTask(null)}
              onSelectTask={selectTask}
            />
          </RelayErrorBoundary>
        </div>
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createAction={selectTask}
      />
    </div>
    </WorkspaceRefreshProvider>
  );
}

function TasksPane({
  query,
  filters,
  isPending,
  currentUserId,
  hasActiveFilters,
  selectedTaskId,
  onSelectTask,
  onClearSelection,
  onResetFilters,
  onFilterChange,
}: {
  query: React.ComponentProps<typeof FilterBar>["query"];
  filters: TaskFilters;
  isPending: boolean;
  currentUserId: string;
  hasActiveFilters: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onClearSelection: (taskId: string) => void;
  onResetFilters: () => void;
  onFilterChange: (filters: TaskFilters) => void;
}) {
  const { tasksKey } = useWorkspaceRefresh();
  const data = useLazyLoadQuery<RelayTasksQuery>(
    tasksQuery,
    { filters: toGraphQLFilters(filters) },
    { fetchKey: tasksKey, fetchPolicy: "store-or-network" },
  );

  return (
    <>
      <React.Suspense fallback={<FilterBarSkeleton />}>
        <FilterBar
          query={query}
          filters={filters}
          taskCount={data.tasks.length}
          isPending={isPending}
          onFilterChange={onFilterChange}
          onResetFilters={onResetFilters}
        />
      </React.Suspense>
      <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
        <TaskList
          tasks={data.tasks}
          currentUserId={currentUserId}
          hasActiveFilters={hasActiveFilters}
          dimmed={isPending}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onClearSelection={onClearSelection}
          onResetFilters={onResetFilters}
        />
      </div>
    </>
  );
}

function SidebarError({ error }: { error: unknown }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar p-3 md:block">
      <SectionError
        title="Workspace unavailable"
        message={error instanceof Error ? error.message : undefined}
      />
    </aside>
  );
}

function TaskDetailError({
  error,
  onClose,
}: {
  error: unknown;
  onClose: () => void;
}) {
  return (
    <aside className="scrollbar-calm hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface p-4 lg:block">
      <SectionError
        title="Couldn't load this task"
        message={error instanceof Error ? error.message : undefined}
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
