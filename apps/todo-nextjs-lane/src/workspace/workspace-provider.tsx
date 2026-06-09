"use client";

import { createLane, type Lane, type LaneHydrationSnapshots } from "@lane/lane";
import type { CurrentUser } from "@lane/todo-api";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import type { WorkspaceCtx } from "@/api/client";

type WorkspaceContextValue = {
  ctx: WorkspaceCtx;
  lane: Lane;
  userId: string;
  sessionUser: CurrentUser;
  activeTeamId: string;
  isSignedIn: boolean;
  signOut: () => void;
  signIn: () => void;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

type HydrationResource = {
  promise: Promise<void>;
  reason: unknown;
  status: "pending" | "fulfilled" | "rejected";
};

const hydrationResources = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, HydrationResource>
>();

export function WorkspaceProvider({
  initialUser,
  initialTeamId,
  snapshots,
  children,
}: {
  initialUser: CurrentUser;
  initialTeamId: string;
  snapshots: LaneHydrationSnapshots;
  children: React.ReactNode;
}) {
  const [lane] = React.useState(() => createLane());

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
      lane,
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
      lane,
      signIn,
      signOut,
      userId,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <LaneHydration lane={lane} snapshots={snapshots}>
        {children}
      </LaneHydration>
    </WorkspaceContext.Provider>
  );
}

function LaneHydration({
  lane,
  snapshots,
  children,
}: {
  lane: Lane;
  snapshots: LaneHydrationSnapshots;
  children: React.ReactNode;
}) {
  const resource = getHydrationResource(lane, snapshots);

  if (resource.status === "rejected") {
    throw resource.reason;
  }

  if (resource.status !== "fulfilled") {
    React.use(resource.promise);
  }

  return children;
}

function getHydrationResource(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): HydrationResource {
  let resourcesByLane = hydrationResources.get(snapshots);

  if (!resourcesByLane) {
    resourcesByLane = new WeakMap();
    hydrationResources.set(snapshots, resourcesByLane);
  }

  const existing = resourcesByLane.get(lane);

  if (existing) {
    return existing;
  }

  const resource = createHydrationResource(lane, snapshots);
  resourcesByLane.set(lane, resource);
  return resource;
}

function createHydrationResource(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): HydrationResource {
  const resource: HydrationResource = {
    promise: Promise.resolve(),
    reason: undefined,
    status: "pending",
  };

  resource.promise = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        lane.hydrateMany(snapshots);
        resource.status = "fulfilled";
        resolve();
      } catch (error) {
        resource.reason = error;
        resource.status = "rejected";
        reject(error);
      }
    }, 0);
  });

  return resource;
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
