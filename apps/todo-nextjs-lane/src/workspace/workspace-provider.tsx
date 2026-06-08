"use client";

import { createLane, type Lane } from "@lane/lane";
import type { CurrentUser } from "@lane/todo-api";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/api/client";
import {
  TEAM_SCOPED_KEYS,
  type WorkspaceSeeds,
  workspaceSeedEntries,
} from "@/api/query-options";

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  lane: Lane;
  userId: string;
  sessionUser: CurrentUser;
  activeTeamId: string;
  isSignedIn: boolean;
  switchTeam: (teamId: string) => void;
  signOut: () => void;
  signIn: () => void;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  initialUser,
  initialTeamId,
  initialSeeds,
  children,
}: {
  initialUser: CurrentUser;
  initialTeamId: string;
  initialSeeds: WorkspaceSeeds;
  children: React.ReactNode;
}) {
  const [lane] = React.useState(() => createLane());
  lane.seedMany(workspaceSeedEntries(initialSeeds));

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [userId] = React.useState(initialUser.id);
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  const activeTeamId = searchParams.get("team")?.trim() || initialTeamId;

  const switchTeam = React.useCallback(
    (teamId: string) => {
      if (teamId === activeTeamId) {
        return;
      }

      for (const key of TEAM_SCOPED_KEYS) {
        lane.removeAll(key);
      }

      router.push(`${pathname}?team=${encodeURIComponent(teamId)}`);
    },
    [activeTeamId, lane, pathname, router],
  );

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
      lane,
      sessionUser: initialUser,
      signIn,
      signOut,
      switchTeam,
      userId,
    }),
    [
      activeTeamId,
      ctx,
      initialUser,
      isSignedIn,
      lane,
      signIn,
      signOut,
      switchTeam,
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

export function useWorkspaceLane(): Lane {
  return useWorkspace().lane;
}
