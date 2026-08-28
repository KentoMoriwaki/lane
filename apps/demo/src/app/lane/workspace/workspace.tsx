"use client";

import * as React from "react";
import { CreateTaskDialog } from "./create-task-dialog";
import { SectionError } from "./feedback";
import { LaneErrorBoundary } from "./lane-error-boundary";
import { SignInScreen } from "./sign-in-screen";
import { Topbar } from "./topbar";
import { useWorkspace, useWorkspaceRefresh } from "./workspace-provider";

/**
 * The persistent workspace frame.
 *
 * It lives in the shared route-group layout. Sidebar, Topbar, and open-create
 * state stay mounted while `children` is the active Context page. Task detail
 * lands in the route-group's `@modal` slot beside the active list.
 */
export type WorkspaceProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export type WorkspaceContentProps = {
  contextHeader: React.ReactNode;
  filterBar: React.ReactNode;
  taskList: React.ReactNode;
};

export function Workspace(props: WorkspaceProps) {
  const { isSignedIn } = useWorkspace();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceFrame {...props} />;
}

function WorkspaceFrame({ sidebar, children }: WorkspaceProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const { refresh, isRefreshing } = useWorkspaceRefresh();

  const retry = React.useCallback(
    (retryBoundary: () => void) => {
      // Every section retries the same way: ask the owner to publish again,
      // then let the boundary re-render into whatever arrives.
      refresh();
      retryBoundary();
    },
    [refresh],
  );

  return (
    <div className="flex min-w-0 flex-1">
      <LaneErrorBoundary
        resetKey="sidebar"
        fallback={(error, retryBoundary) => (
          <SidebarError error={error} onRetry={() => retry(retryBoundary)} />
        )}
      >
        {sidebar}
      </LaneErrorBoundary>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onNewTask={() => setCreateOpen(true)}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />

        {children}
      </div>

      {/* Mounted on open: it reads the URL to open what it creates, which
          would otherwise make this frame dynamic. */}
      {createOpen ? (
        <CreateTaskDialog closeAction={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}

/** The visible regions owned by one Context page. */
export function WorkspaceContent({
  contextHeader,
  filterBar,
  taskList,
}: WorkspaceContentProps) {
  const { refresh } = useWorkspaceRefresh();

  const retry = React.useCallback(
    (retryBoundary: () => void) => {
      refresh();
      retryBoundary();
    },
    [refresh],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <LaneErrorBoundary
        resetKey="context"
        fallback={(error, retryBoundary) => (
          <div className="border-b border-border px-4 py-3">
            <SectionError
              title="Context unavailable"
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => retry(retryBoundary)}
            />
          </div>
        )}
      >
        {contextHeader}
      </LaneErrorBoundary>

      <LaneErrorBoundary
        resetKey="filters"
        fallback={(error, retryBoundary) => (
          <div className="border-b border-border px-4 py-3">
            <SectionError
              title="Filters unavailable"
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => retry(retryBoundary)}
            />
          </div>
        )}
      >
        {filterBar}
      </LaneErrorBoundary>

      <div className="scrollbar-calm min-h-0 flex-1 overflow-y-auto">
        <LaneErrorBoundary
          resetKey="tasks"
          fallback={(error, retryBoundary) => (
            <div className="p-4">
              <SectionError
                title="Couldn't load tasks"
                message={error instanceof Error ? error.message : undefined}
                onRetry={() => retry(retryBoundary)}
              />
            </div>
          )}
        >
          {taskList}
        </LaneErrorBoundary>
      </div>
    </section>
  );
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
