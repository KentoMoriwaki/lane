"use client";

import { createLane, LaneProvider } from "use-lane";
import type { CurrentUser } from "@/server/api";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceCtx } from "@/app/lane/api/client";
import { refreshWorkspaceAction } from "@/app/lane/api/actions";

type WorkspaceContextValue = {
  /** Unresolved on purpose — see `WorkspaceProvider`. */
  session: Promise<CurrentUser>;
  isSignedIn: boolean;
  signOut: () => void;
  signIn: () => void;
  /** Ask the owner to publish again. */
  refresh: () => void;
  isRefreshing: boolean;
  /** Set when the last refresh could not be honored; cleared when one is. */
  error: unknown;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  session,
  children,
}: {
  /**
   * The session, unresolved.
   *
   * A promise rather than a value because this provider sits above the frame —
   * one store has to serve every region — and anything it awaits, the frame
   * awaits with it, which would push the whole screen behind one boundary and
   * bring back the hand-written whole-screen fallback. Nothing here needs the
   * session at render: `loaderMeta` is only consumed when a loader runs, and
   * every workspace read is `external`, so none do. The consumers that need a
   * resolved session — the mutation hooks, the team switcher, the row
   * highlighting — all sit inside a region and `use()` it there, where the
   * suspension is covered by that region's own boundary.
   */
  session: Promise<CurrentUser>;
  children: React.ReactNode;
}) {
  // The lane is created here rather than above, because this component owns the
  // value the lane hands its loaders: `ctx` is derived from the session and the
  // team in the URL, and `loaderMeta` is how it reaches every read without any
  // of them taking it as an argument. (The workspace reads are `external` and
  // ask nothing of it; the meta stays because the session is still what decides
  // which workspace the *server* publishes.)
  const [lane, setLane] = React.useState(createLane);
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  const [isRefreshing, startRefresh] = React.useTransition();
  const [error, setError] = React.useState<unknown>(undefined);
  const router = useRouter();

  // The owner-ask. Lane calls this when a reader needs an external key that has
  // been marked stale, and `router.refresh()` is what "publish again" means in
  // this router. Out of render and coalesced to one call per tick by Lane, so
  // several invalidated keys are still one rerender.
  //
  // One mutation fires it: an edit made on the task page, which marks the list
  // entries stale because where a row now sorts is the one thing a response
  // cannot carry (`api/hooks.ts`). The ask waits until a list is revealed —
  // a marked key with no reader stays marked — so this is the traverse back,
  // not the edit.
  const askOwnerToPublish = React.useCallback(() => {
    router.refresh();
  }, [router]);

  const signOut = React.useCallback(() => {
    // Not `lane.removeAll`: removing the keys would leave a store full of
    // published shells whose owner is still willing to fill them, and the next
    // reader would ask for exactly the data being signed out of. Dropping the
    // *lane* ends the session's copy outright — the store goes with it, and the
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

  // Empty ids are the API's signal to resolve its own defaults. Nothing reads
  // this: every workspace read is `external`, so no loader ever runs and no
  // loader ever asks for its meta. Reading the URL to fill it in would make
  // this provider — and the frame under it — request-dependent, which is the
  // one thing it must not be.
  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId: "", teamId: "" }),
    [],
  );

  // The manual refresh, and the only shape it can take here: ask the server to
  // publish again. A transition, so the current publication stays on screen
  // while the next one is produced — and the rejection is kept rather than
  // thrown, because a refresh that failed is a notice beside data that is still
  // perfectly displayable. That notice is the chip in the task list.
  const refresh = React.useCallback(() => {
    startRefresh(async () => {
      try {
        // Resolved here rather than at render: a callback can await the session
        // without suspending anything.
        const user = await session;
        // Read at call time, not at render: a callback may look at the URL
        // without making its component depend on it.
        const urlTeamId =
          new URLSearchParams(window.location.search).get("team")?.trim() ?? "";
        await refreshWorkspaceAction({
          userId: user.id,
          teamId: urlTeamId || user.defaultTeamId,
        });
        setError(undefined);
      } catch (error) {
        setError(error);
      }
    });
  }, [session]);

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      isRefreshing,
      isSignedIn,
      refresh,
      error,
      session,
      signIn,
      signOut,
    }),
    [error, isRefreshing, isSignedIn, refresh, session, signIn, signOut],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <LaneProvider lane={lane} loaderMeta={ctx} refresh={askOwnerToPublish}>
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

/**
 * The session, resolved. Suspends its caller, which is why every caller lives
 * inside a region — the region's boundary covers it.
 */
export function useSessionUser(): CurrentUser {
  return React.use(useWorkspace().session);
}

/**
 * The context a mutation sends. Reads the URL, so every caller sits inside a
 * region and suspends under that region's boundary — never above one.
 */
export function useWorkspaceCtx(): WorkspaceCtx {
  const searchParams = useSearchParams();
  const urlTeamId = searchParams.get("team")?.trim() ?? "";
  const user = useSessionUser();

  return React.useMemo(
    () => ({ userId: user.id, teamId: urlTeamId || user.defaultTeamId }),
    [urlTeamId, user.defaultTeamId, user.id],
  );
}

/** The active team id, resolved through the session when the URL names none. */
export function useActiveTeamId(): string {
  return useWorkspaceCtx().teamId;
}

/**
 * The owner-channel refresh, for the controls that offer one: the topbar button
 * that asks for it, and the chip that reports when it could not be honored.
 */
export function useWorkspaceRefresh(): {
  refresh: () => void;
  isRefreshing: boolean;
  error: unknown;
} {
  const { refresh, isRefreshing, error } = useWorkspace();

  return { isRefreshing, refresh, error };
}
