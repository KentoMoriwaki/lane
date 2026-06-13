"use client";

import { useLaneInstance } from "use-lane";
import type { CurrentUser } from "@/server/api";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/app/lane/api/client";

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  userId: string;
  sessionUser: CurrentUser;
  activeTeamId: string;
  isSignedIn: boolean;
  signOut: () => void;
  signIn: () => void;
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
  const lane = useLaneInstance();
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
      {children}
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
