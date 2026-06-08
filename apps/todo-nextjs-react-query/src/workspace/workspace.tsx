"use client";

import type { TaskPriority, TaskScope, TaskStatus } from "@lane/todo-api";
import * as React from "react";
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
import { useWorkspaceUrl } from "./use-workspace-url";
import { useWorkspace } from "./workspace-provider";

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function Workspace() {
  const { isSignedIn } = useWorkspace();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const {
    filters,
    selectedTaskId,
    patchFilters,
    applyView,
    resetFilters,
    selectTask,
  } = useWorkspaceUrl();
  const [createOpen, setCreateOpen] = React.useState(false);
  const { refresh, isRefreshing } = useWorkspaceRefresh();

  // Local, snappy search input that is debounced into the durable URL state.
  const [searchInput, setSearchInput] = React.useState(filters.q);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const committedQ = React.useRef(filters.q);

  // Typed input (debounced) -> URL. Replace (not push) so each keystroke does
  // not create a separate history entry.
  React.useEffect(() => {
    if (debouncedSearch !== committedQ.current) {
      committedQ.current = debouncedSearch;
      patchFilters({ q: debouncedSearch }, "replace");
    }
  }, [debouncedSearch, patchFilters]);

  // External URL changes (back/forward, team switch, clear) -> input.
  React.useEffect(() => {
    if (filters.q !== committedQ.current) {
      committedQ.current = filters.q;
      setSearchInput(filters.q);
    }
  }, [filters.q]);

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
                patchFilters({ status: toggle(filters.status, status) })
              }
              onTogglePriority={(priority: TaskPriority) =>
                patchFilters({ priority: toggle(filters.priority, priority) })
              }
              onPatch={patchFilters}
              onResetAll={resetFilters}
            />
            <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
              <TaskList
                filters={filters}
                hasActiveFilters={hasActiveFilters}
                selectedTaskId={selectedTaskId}
                onSelectTask={selectTask}
                onClearSelection={clearSelectionFor}
                onResetFilters={resetFilters}
              />
            </div>
          </section>

          <TaskDetailPanel
            taskId={selectedTaskId}
            onClose={() => selectTask(null)}
          />
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
