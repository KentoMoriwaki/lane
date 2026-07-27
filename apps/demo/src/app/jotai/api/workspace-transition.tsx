"use client";

import * as React from "react";

type Transition = {
  isPending: boolean;
  /** Wrap any atom write whose new data should not blank the screen. */
  startTransition: React.TransitionStartFunction;
};

const ListTransitionContext = React.createContext<Transition | null>(null);
const DetailTransitionContext = React.createContext<Transition | null>(null);

/**
 * One transition per region that can be replaced on its own.
 *
 * An async atom has no `isFetching` flag to read — the promise it holds either
 * suspends the reader or resolves, and nothing in between is observable. What
 * keeps the current screen up while the next one loads is React's transition,
 * so the pending state belongs to whoever started it, not to the atom.
 *
 * That makes the *scope* of a transition the thing to get right, and it is the
 * one place this variant has to do by hand what a status object gives a
 * fetching library for free. A single workspace-wide transition would report a
 * task being opened as the task list being replaced: the filter bar would say
 * "Updating" and the list would dim for a read neither of them has anything to
 * do with. So there are two. Filters, the manual refresh and a team switch
 * replace the list; opening or closing a task replaces the detail panel; each
 * reports only its own.
 */
export function WorkspaceTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isListPending, startListTransition] = React.useTransition();
  const [isDetailPending, startDetailTransition] = React.useTransition();

  const list = React.useMemo(
    () => ({ isPending: isListPending, startTransition: startListTransition }),
    [isListPending, startListTransition],
  );
  const detail = React.useMemo(
    () => ({
      isPending: isDetailPending,
      startTransition: startDetailTransition,
    }),
    [isDetailPending, startDetailTransition],
  );

  return (
    <ListTransitionContext.Provider value={list}>
      <DetailTransitionContext.Provider value={detail}>
        {children}
      </DetailTransitionContext.Provider>
    </ListTransitionContext.Provider>
  );
}

function useRegionTransition(
  context: React.Context<Transition | null>,
  hookName: string,
): Transition {
  const value = React.useContext(context);
  if (!value) {
    throw new Error(
      `${hookName} must be used within a WorkspaceTransitionProvider`,
    );
  }
  return value;
}

/** The task list, and every write that addresses which list that is. */
export function useWorkspaceTransition(): Transition {
  return useRegionTransition(ListTransitionContext, "useWorkspaceTransition");
}

/** The detail panel, and the selection that decides what it shows. */
export function useDetailTransition(): Transition {
  return useRegionTransition(DetailTransitionContext, "useDetailTransition");
}
