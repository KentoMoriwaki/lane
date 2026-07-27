"use client";

import * as React from "react";

type WorkspaceTransition = {
  isPending: boolean;
  /** Wrap any atom write whose new data should not blank the screen. */
  startTransition: React.TransitionStartFunction;
};

const WorkspaceTransitionContext =
  React.createContext<WorkspaceTransition | null>(null);

/**
 * One transition for the whole workspace.
 *
 * An async atom has no `isFetching` flag to read — the promise it holds either
 * suspends the reader or resolves, and nothing in between is observable. What
 * keeps the current list on screen while the next one loads is React's
 * transition, so the pending state belongs to whoever started it, not to the
 * atom. Sharing one transition is how a filter change and a manual refresh
 * both reach the list and the filter bar; the trade-off against a per-read
 * flag is that they cannot report on different reads independently.
 */
export function WorkspaceTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = React.useTransition();
  const value = React.useMemo(
    () => ({ isPending, startTransition }),
    [isPending, startTransition],
  );

  return (
    <WorkspaceTransitionContext.Provider value={value}>
      {children}
    </WorkspaceTransitionContext.Provider>
  );
}

export function useWorkspaceTransition(): WorkspaceTransition {
  const value = React.useContext(WorkspaceTransitionContext);
  if (!value) {
    throw new Error(
      "useWorkspaceTransition must be used within a WorkspaceTransitionProvider",
    );
  }
  return value;
}
