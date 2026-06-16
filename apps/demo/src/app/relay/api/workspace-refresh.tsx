"use client";

import * as React from "react";

/**
 * Revalidation coordination for the workspace.
 *
 * The normalized store already keeps every view of a task consistent on its own
 * (an edit re-renders each row, `store.delete` drops a task from every list), so
 * a mutation should NOT blanket-refetch the task list — doing so suspends the
 * list and masks that instant store propagation. Instead a mutation reports what
 * it did, and only the reads that the store can't reconcile revalidate:
 *
 * - `insightsKey` → the team-wide counters (a separate query; refetching it
 *   never freezes the list). Bumped on any write.
 * - `tasksKey` → the task list. Bumped only when list *membership* can change
 *   in a way the store can't express: a newly created task, or an edit while a
 *   filter is narrowing the list.
 */
export type MutationKind = "edit" | "create" | "delete";

export type WorkspaceRefresh = {
  insightsKey: number;
  tasksKey: number;
  notifyMutation: (kind: MutationKind) => void;
  refreshAll: () => void;
};

const WorkspaceRefreshContext = React.createContext<WorkspaceRefresh | null>(
  null,
);

export const WorkspaceRefreshProvider = WorkspaceRefreshContext.Provider;

export function useWorkspaceRefresh(): WorkspaceRefresh {
  const value = React.useContext(WorkspaceRefreshContext);
  if (!value) {
    throw new Error(
      "useWorkspaceRefresh must be used within the workspace shell",
    );
  }
  return value;
}
