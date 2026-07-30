"use client";

import { createLane, LaneProvider, useLaneInstance, type Lane } from "use-lane";
import type { CurrentUser } from "@/server/api";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/app/lane-spa/api/client";

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  userId: string;
  sessionUser: CurrentUser;
  activeTeamId: string;
  isSignedIn: boolean;
  signOut: () => void;
  signIn: () => void;
  setActiveTeamId?: (teamId: string) => void;
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
  // See `ClientWorkspaceProvider` below: this component owns the session, so it
  // owns the lane that carries it.
  const laneRef = React.useRef<Lane>(undefined);
  const lane = (laneRef.current ??= createLane());
  const searchParams = useSearchParams();
  const [userId] = React.useState(initialUser.id);
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  const activeTeamId = searchParams.get("team")?.trim() || initialTeamId;

  const signOut = React.useCallback(() => {
    lane.removeAll(() => true);
    setIsSignedIn(false);
  }, [lane]);

  const signIn = React.useCallback(() => {
    setIsSignedIn(true);
  }, []);

  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId, teamId: activeTeamId }),
    [userId, activeTeamId],
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      activeTeamId,
      ctx,
      isSignedIn,
      sessionUser: initialUser,
      signIn,
      signOut,
      userId,
    }),
    [
      activeTeamId,
      ctx,
      initialUser,
      isSignedIn,
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

export function ClientWorkspaceProvider({
  initialUser,
  initialTeamId,
  children,
}: {
  initialUser: CurrentUser;
  initialTeamId: string;
  children: React.ReactNode;
}) {
  // The lane already exists: the bootstrap above this component read the current
  // user through it, under the session-less meta. Re-providing the *same* lane
  // with the real session keeps that entry — and everything else cached — while
  // every later read is handed the session instead. The meta is not part of any
  // key, which is exactly why the swap costs nothing.
  const lane = useLaneInstance();
  const [userId] = React.useState(initialUser.id);
  const [activeTeamId, setActiveTeamId] = React.useState(initialTeamId);
  const [isSignedIn, setIsSignedIn] = React.useState(true);

  const signOut = React.useCallback(() => {
    lane.removeAll(() => true);
    setIsSignedIn(false);
  }, [lane]);

  const signIn = React.useCallback(() => {
    setIsSignedIn(true);
  }, []);

  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId, teamId: activeTeamId }),
    [userId, activeTeamId],
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      activeTeamId,
      ctx,
      isSignedIn,
      sessionUser: initialUser,
      setActiveTeamId,
      signIn,
      signOut,
      userId,
    }),
    [
      activeTeamId,
      ctx,
      initialUser,
      isSignedIn,
      setActiveTeamId,
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
