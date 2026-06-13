"use client";

import type { CurrentUser } from "@lane/todo-api";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/app/react-query/api/client";
import { TEAM_SCOPED_KEYS } from "@/app/react-query/api/query-options";

type WorkspaceContextValue = {
  /** Headers context sent to the API. Stable unless the user or team changes. */
  ctx: WorkspaceCtx;
  userId: string;
  /** Static identity for the mock session (survives a cache clear). */
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
  children,
}: {
  initialUser: CurrentUser;
  initialTeamId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [userId] = React.useState(initialUser.id);
  const [isSignedIn, setIsSignedIn] = React.useState(true);

  // The active team is durable URL state. It falls back to the team the server
  // resolved for this request when no `team` param is present.
  const activeTeamId = searchParams.get("team")?.trim() || initialTeamId;

  const switchTeam = React.useCallback(
    (teamId: string) => {
      if (teamId === activeTeamId) {
        return;
      }

      // The new team owns a fresh workspace. Drop every team-scoped query so
      // stale tasks/labels/members/projects from the previous team can never be
      // shown as if they belonged to the new one (team is not in the keys).
      for (const key of TEAM_SCOPED_KEYS) {
        queryClient.removeQueries({ queryKey: [...key] });
      }

      // A team change is a route-identity change: navigate so the Server
      // Component re-prefetches the new team's workspace, and reset the other
      // view params (filters/search/selected task) which are team-specific.
      router.push(`${pathname}?team=${encodeURIComponent(teamId)}`);
    },
    [activeTeamId, pathname, queryClient, router],
  );

  const signOut = React.useCallback(() => {
    // Clearing the cache removes all user- and team-scoped data from the UI.
    queryClient.clear();
    setIsSignedIn(false);
  }, [queryClient]);

  const signIn = React.useCallback(() => {
    setIsSignedIn(true);
  }, []);

  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId, teamId: activeTeamId }),
    [userId, activeTeamId],
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      ctx,
      userId,
      sessionUser: initialUser,
      activeTeamId,
      isSignedIn,
      switchTeam,
      signOut,
      signIn,
    }),
    [
      ctx,
      userId,
      initialUser,
      activeTeamId,
      isSignedIn,
      switchTeam,
      signOut,
      signIn,
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
