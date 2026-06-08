"use client";

import type { TaskPriority, TaskScope, TaskStatus } from "@lane/todo-api";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/api/endpoints";
import { useWorkspaceRefresh } from "@/api/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { CreateTaskDialog } from "./create-task-dialog";
import { FilterBar } from "./filter-bar";
import { InsightStrip } from "./insight-strip";
import { Sidebar } from "./sidebar";
import { SignInScreen } from "./sign-in-screen";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskList } from "./task-list";
import { Topbar } from "./topbar";
import { useWorkspace } from "./workspace-provider";

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function Workspace() {
  const { isSignedIn, teamEpoch } = useWorkspace();

  // A fresh key per team means switching teams remounts the workspace and
  // resets all local view state (filters, selection, search) cleanly.
  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceShell key={teamEpoch} />;
}

function WorkspaceShell() {
  const [baseFilters, setBaseFilters] = React.useState<TaskFilters>(() => ({
    ...EMPTY_FILTERS,
  }));
  const [searchInput, setSearchInput] = React.useState("");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    null,
  );
  const [createOpen, setCreateOpen] = React.useState(false);

  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const { refresh, isRefreshing } = useWorkspaceRefresh();

  const filters = React.useMemo<TaskFilters>(
    () => ({ ...baseFilters, q: debouncedSearch.trim() }),
    [baseFilters, debouncedSearch],
  );

  const applyView = React.useCallback((view: Partial<TaskFilters>) => {
    setBaseFilters({ ...EMPTY_FILTERS, ...view, q: "" });
    setSearchInput("");
  }, []);

  const patchFilters = React.useCallback((patch: Partial<TaskFilters>) => {
    setBaseFilters((current) => ({ ...current, ...patch }));
  }, []);

  const resetAll = React.useCallback(() => {
    setBaseFilters({ ...EMPTY_FILTERS });
    setSearchInput("");
  }, []);

  const clearSelectionFor = React.useCallback((taskId: string) => {
    setSelectedTaskId((current) => (current === taskId ? null : current));
  }, []);

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
      <Sidebar filters={filters} onApplyView={applyView} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          search={searchInput}
          onSearchChange={setSearchInput}
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <InsightStrip onApplyView={applyView} />
            <FilterBar
              filters={filters}
              onScopeChange={(scope: TaskScope) => patchFilters({ scope })}
              onToggleStatus={(status: TaskStatus) =>
                setBaseFilters((current) => ({
                  ...current,
                  status: toggle(current.status, status),
                }))
              }
              onTogglePriority={(priority: TaskPriority) =>
                setBaseFilters((current) => ({
                  ...current,
                  priority: toggle(current.priority, priority),
                }))
              }
              onPatch={patchFilters}
              onResetAll={resetAll}
            />
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <TaskList
                filters={filters}
                hasActiveFilters={hasActiveFilters}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onClearSelection={clearSelectionFor}
                onResetFilters={resetAll}
              />
            </div>
          </section>

          <TaskDetailPanel
            taskId={selectedTaskId}
            onClose={() => setSelectedTaskId(null)}
          />
        </div>
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setSelectedTaskId}
      />
    </div>
  );
}
