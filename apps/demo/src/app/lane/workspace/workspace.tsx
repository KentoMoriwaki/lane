"use client";

import * as React from "react";
import { CreateTaskDialog } from "./create-task-dialog";
import { SectionError } from "./feedback";
import { LaneErrorBoundary } from "./lane-error-boundary";
import { SignInScreen } from "./sign-in-screen";
import { Topbar } from "./topbar";
import { useWorkspaceUrl } from "./use-workspace-url";
import { useWorkspace, useWorkspaceRefresh } from "./workspace-provider";

/**
 * The frame, and only the frame.
 *
 * It reads nothing. Every region arrives as an already-rendered slot from the
 * server, each behind its own Suspense boundary, so this component and the
 * layout it draws are part of the route's static shell — there is no
 * hand-written whole-screen skeleton any more, because the shell *is* this
 * frame with each slot showing its own fallback.
 *
 * What stays here is the chrome that is genuinely client state: the session
 * gate, the search field, the create dialog, and the retry boundaries.
 */
export type WorkspaceSlots = {
  sidebar: React.ReactNode;
  insights: React.ReactNode;
  filterBar: React.ReactNode;
  taskList: React.ReactNode;
  detail: React.ReactNode;
};

export function Workspace(slots: WorkspaceSlots) {
  const { isSignedIn } = useWorkspace();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceFrame {...slots} />;
}

function WorkspaceFrame({
  sidebar,
  insights,
  filterBar,
  taskList,
  detail,
}: WorkspaceSlots) {
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
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
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

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <LaneErrorBoundary
              resetKey="insights"
              fallback={(error, retryBoundary) => (
                <div className="border-b border-border px-4 py-3">
                  <SectionError
                    title="Insights unavailable"
                    message={error instanceof Error ? error.message : undefined}
                    onRetry={() => retry(retryBoundary)}
                  />
                </div>
              )}
            >
              {insights}
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
                      message={
                        error instanceof Error ? error.message : undefined
                      }
                      onRetry={() => retry(retryBoundary)}
                    />
                  </div>
                )}
              >
                {taskList}
              </LaneErrorBoundary>
            </div>
          </section>

          <LaneErrorBoundary
            resetKey="detail"
            fallback={(error, retryBoundary) => (
              <TaskDetailError
                error={error}
                onRetry={() => retry(retryBoundary)}
              />
            )}
          >
            {detail}
          </LaneErrorBoundary>
        </div>
      </div>

      {/* Mounted on open: it reads the URL to select what it creates, which
          would otherwise make this frame dynamic. */}
      {createOpen ? (
        <CreateTaskDialog closeAction={() => setCreateOpen(false)} />
      ) : null}
    </div>
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

function TaskDetailError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const { selectTask } = useWorkspaceUrl();
  const onClose = () => selectTask(null);

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
