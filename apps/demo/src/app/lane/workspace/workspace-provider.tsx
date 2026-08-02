"use client";

import { createLane, LaneProvider } from "use-lane";
import type { CurrentUser } from "@/server/api";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/app/lane/api/client";
import { refreshWorkspaceAction } from "@/app/lane/api/actions";

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  userId: string;
  sessionUser: CurrentUser;
  activeTeamId: string;
  isSignedIn: boolean;
  signOut: () => void;
  signIn: () => void;
  /** Ask the owner to publish again. */
  refresh: () => void;
  isRefreshing: boolean;
  /** Set when the last refresh could not be honored; cleared when one is. */
  refreshError: unknown;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  initialUser,
  initialTeamId,
  children,
}: {
  initialUser: CurrentUser;
  initialTeamId: string;
  children: React.ReactNode;
}) {
  // The lane is created here rather than above, because this component owns the
  // value the lane hands its loaders: `ctx` is derived from the session and the
  // team in the URL, and `loaderMeta` is how it reaches every read without any
  // of them taking it as an argument. (The workspace reads are `external` and
  // ask nothing of it; the meta stays because the session is still what decides
  // which workspace the *server* publishes.)
  const [lane, setLane] = React.useState(createLane);
  const searchParams = useSearchParams();
  const [userId] = React.useState(initialUser.id);
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  const [isRefreshing, startRefresh] = React.useTransition();
  const [refreshError, setRefreshError] = React.useState<unknown>(undefined);
  const activeTeamId = searchParams.get("team")?.trim() || initialTeamId;

  const signOut = React.useCallback(() => {
    // Not `lane.removeAll` — these entries are published, and a client may not
    // remove what it does not own. Dropping the *lane* is the honest way to end
    // a session's copy of someone else's data: the store goes with it, and the
    // boundary above re-seeds whatever lane it finds next (it reads the lane
    // from context, so a swap re-runs its publish).
    //
    // In a transition because that re-seed suspends: the current screen stays up
    // until the new lane has been published into, instead of the sign-out
    // flashing a fallback on its way to the signed-out screen.
    React.startTransition(() => {
      setLane(createLane());
      setIsSignedIn(false);
    });
  }, []);

  const signIn = React.useCallback(() => {
    setIsSignedIn(true);
  }, []);

  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId, teamId: activeTeamId }),
    [userId, activeTeamId],
  );

  // The manual refresh, and the only shape it can take here: ask the server to
  // publish again. A transition, so the current publication stays on screen
  // while the next one is produced — and the rejection is kept rather than
  // thrown, because a refresh that failed is a notice beside data that is still
  // perfectly displayable. That notice is the chip in the task list.
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

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      activeTeamId,
      ctx,
      isRefreshing,
      isSignedIn,
      refresh,
      refreshError,
      sessionUser: initialUser,
      signIn,
      signOut,
      userId,
    }),
    [
      activeTeamId,
      ctx,
      initialUser,
      isRefreshing,
      isSignedIn,
      refresh,
      refreshError,
      signIn,
      signOut,
      userId,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <LaneProvider lane={lane} loaderMeta={ctx}>
        {children}
      </LaneProvider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = React.useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}

export function useWorkspaceCtx(): WorkspaceCtx {
  return useWorkspace().ctx;
}

/**
 * The owner-channel refresh, for the controls that offer one: the topbar button
 * that asks for it, and the chip that reports when it could not be honored.
 */
export function useWorkspaceRefresh(): {
  refresh: () => void;
  isRefreshing: boolean;
  refreshError: unknown;
} {
  const { refresh, isRefreshing, refreshError } = useWorkspace();

  return { isRefreshing, refresh, refreshError };
}
