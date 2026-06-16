"use client";

import * as React from "react";
import { RelayEnvironmentProvider } from "react-relay";
import { createRelayEnvironment, type WorkspaceCtx } from "./environment";

/**
 * The session identity the sign-in screen needs after the store is cleared.
 * Captured from the workspace query's `viewer` once it loads.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  defaultTeamId: string;
};

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  activeTeamId: string | null;
  setActiveTeamId: (teamId: string) => void;
  isSignedIn: boolean;
  signIn: () => void;
  signOut: () => void;
  sessionUser: SessionUser | null;
  setSessionUser: (user: SessionUser) => void;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

/**
 * Owns the Relay environment and the session/team identity for the variant.
 *
 * One environment is created per active team: switching teams (or signing out)
 * recreates it, starting from a clean normalized store — the Relay equivalent of
 * the other variants clearing their cache. Because the environment lives above
 * the query tree, the active team is sent on every request as a header (see
 * `environment.ts`) without threading it through every query.
 */
export function RelayWorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeTeamId, setActiveTeamIdState] = React.useState<string | null>(
    null,
  );
  const [isSignedIn, setIsSignedIn] = React.useState(true);
  const [authEpoch, setAuthEpoch] = React.useState(0);
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(
    null,
  );

  // userId is left empty: the embedded API resolves the default mock user, who
  // belongs to every demo team. Only the team varies, so the environment is
  // keyed on it (plus an auth epoch that resets the store on sign-out).
  const ctx = React.useMemo<WorkspaceCtx>(
    () => ({ userId: "", teamId: activeTeamId ?? "" }),
    [activeTeamId],
  );

  const environment = React.useMemo(
    () => createRelayEnvironment(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.teamId, authEpoch],
  );

  const setActiveTeamId = React.useCallback((teamId: string) => {
    setActiveTeamIdState(teamId);
  }, []);

  const signOut = React.useCallback(() => {
    setIsSignedIn(false);
    // New environment + store: the cleared-from-this-device guarantee.
    setAuthEpoch((epoch) => epoch + 1);
  }, []);

  const signIn = React.useCallback(() => {
    setIsSignedIn(true);
  }, []);

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      ctx,
      activeTeamId,
      setActiveTeamId,
      isSignedIn,
      signIn,
      signOut,
      sessionUser,
      setSessionUser,
    }),
    [
      ctx,
      activeTeamId,
      setActiveTeamId,
      isSignedIn,
      signIn,
      signOut,
      sessionUser,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <RelayEnvironmentProvider environment={environment}>
        {children}
      </RelayEnvironmentProvider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = React.useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a RelayWorkspaceProvider");
  }
  return value;
}
