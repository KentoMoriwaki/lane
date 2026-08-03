"use client";

import * as React from "react";
import type {
  CurrentUser,
  Insights,
  Project,
  Task,
  TeamLabel,
  TeamMember,
  TeamSummary,
} from "@/server/api";
import { refreshWorkspaceAction } from "@/app/lane/api/actions";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { buildWorkspaceHref } from "@/app/lane/api/url-state";
import { Button } from "@/components/ui/button";
import { CreateTaskDialog } from "./create-task-dialog";
import { FilterBar } from "./filter-bar";
import { InsightStrip } from "./insight-strip";
import { Sidebar } from "./sidebar";
import { TaskDetail } from "./task-detail";
import { TaskList } from "./task-list";
import { Topbar } from "./topbar";
import { useDebouncedSearchField } from "./use-debounced-search-field";
import { useWorkspaceUrl } from "./use-workspace-url";

export type WorkspaceContext = {
  userId: string;
  teamId: string;
};

export type WorkspaceProps = {
  currentUser: CurrentUser;
  teams: TeamSummary[];
  activeTeamId: string;
  tasks: Task[];
  insights: Insights;
  projects: Project[];
  labels: TeamLabel[];
  members: TeamMember[];
  selectedTask: Task | null;
};

/**
 * The same workspace behavior with ordinary values threaded explicitly. Server
 * cache ownership and mutations are shared with /lane; no client data source,
 * provider facade, or keyed store is introduced here.
 */
export function Workspace(props: WorkspaceProps) {
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  if (!isSignedIn) {
    return (
      <SignedOut
        user={props.currentUser}
        onSignIn={() => setIsSignedIn(true)}
      />
    );
  }
  return <WorkspaceScreen {...props} onSignOut={() => setIsSignedIn(false)} />;
}

function WorkspaceScreen({
  currentUser,
  teams,
  activeTeamId,
  tasks,
  insights,
  projects,
  labels,
  members,
  selectedTask,
  onSignOut,
}: WorkspaceProps & { onSignOut: () => void }) {
  const {
    pathname,
    state: urlState,
    filters,
    selectedTaskId,
    isPending: isViewPending,
    patchFilters,
    resetFilters,
    selectTask,
  } = useWorkspaceUrl();
  const ctx = React.useMemo<WorkspaceContext>(
    () => ({ userId: currentUser.id, teamId: activeTeamId }),
    [activeTeamId, currentUser.id],
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<unknown>(undefined);
  const [isRefreshing, startRefresh] = React.useTransition();
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
      buildWorkspaceHref(pathname, urlState, { filters: nextFilters }),
    [pathname, urlState],
  );
  const resetFiltersHref = React.useMemo(
    () =>
      buildWorkspaceHref(pathname, urlState, { filters: { ...EMPTY_FILTERS } }),
    [pathname, urlState],
  );
  const refresh = React.useCallback(() => {
    startRefresh(async () => {
      try {
        await refreshWorkspaceAction(ctx);
        setRefreshError(undefined);
      } catch (error) {
        setRefreshError(error);
      }
    });
  }, [ctx]);
  const clearSelectionFor = React.useCallback(
    (taskId: string) => {
      if (selectedTaskId === taskId) selectTask(null);
    },
    [selectedTaskId, selectTask],
  );
  const hasActiveFilters =
    filters.scope !== "all" ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    Boolean(filters.projectId) ||
    Boolean(filters.labelId) ||
    Boolean(filters.due) ||
    filters.q.trim().length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        currentUser={currentUser}
        teams={teams}
        activeTeamId={activeTeamId}
        filters={filters}
        insights={insights}
        projects={projects}
        labels={labels}
        viewHref={viewHref}
        onSignOut={onSignOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          searchField={searchField}
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing || isViewPending}
        />
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <InsightStrip
              insights={insights}
              filters={filters}
              viewHref={viewHref}
            />
            <FilterBar
              filters={filters}
              projects={projects}
              labels={labels}
              taskCount={tasks.length}
              isPending={isViewPending}
              filterHref={filterHref}
              resetHref={resetFiltersHref}
            />
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <TaskList
                ctx={ctx}
                tasks={tasks}
                currentUserId={currentUser.id}
                selectedTaskId={selectedTaskId}
                hasActiveFilters={hasActiveFilters}
                refreshError={refreshError}
                isRefreshing={isRefreshing}
                isViewPending={isViewPending}
                onRefresh={refresh}
                onSelectTask={selectTask}
                onClearSelection={clearSelectionFor}
                onResetFilters={resetFilters}
              />
            </div>
          </section>
          <TaskDetail
            ctx={ctx}
            taskId={selectedTaskId}
            task={selectedTask}
            members={members}
            projects={projects}
            labels={labels}
            onClose={() => selectTask(null)}
          />
        </div>
      </div>
      <CreateTaskDialog
        ctx={ctx}
        open={createOpen}
        members={members}
        projects={projects}
        labels={labels}
        onOpenChange={setCreateOpen}
        onCreated={selectTask}
      />
    </div>
  );
}

function SignedOut({
  user,
  onSignIn,
}: {
  user: CurrentUser;
  onSignIn: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-xl shadow-foreground/5">
        <p className="text-sm font-medium text-cobalt">Plain App Router</p>
        <h1 className="mt-4 text-lg font-semibold">You&apos;re signed out</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This baseline holds no client data cache. Sign back in to render the
          same server-owned props again.
        </p>
        <Button className="mt-5 w-full" onClick={onSignIn}>
          Continue as {user.name.split(" ")[0]}
        </Button>
      </div>
    </div>
  );
}
