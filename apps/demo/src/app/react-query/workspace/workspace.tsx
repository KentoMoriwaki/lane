"use client";

import type { TaskPriority, TaskScope, TaskStatus } from "@/server/api";
import * as React from "react";
import { useWorkspaceRefresh } from "@/app/react-query/api/hooks";
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
          search={filters.q}
          onSearchChange={(q) => patchFilters({ q }, "replace")}
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
