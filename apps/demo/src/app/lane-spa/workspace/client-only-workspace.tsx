"use client";

import { LaneProvider, useLane } from "use-lane";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane-spa/api/endpoints";
import { workspaceReads } from "@/app/lane-spa/api/lane-reads";
import { NO_SESSION } from "@/lib/lane-meta";
import {
  ClientWorkspaceProvider,
  useWorkspace,
} from "./workspace-provider";
import {
  WorkspaceShell,
  type WorkspaceViewController,
} from "./workspace";
import { SignInScreen } from "./sign-in-screen";

export function ClientOnlyWorkspaceApp() {
  const isBrowser = React.useSyncExternalStore(
    subscribeToBrowser,
    getBrowserSnapshot,
    getServerSnapshot,
  );

  if (!isBrowser) {
    return <ClientOnlyWorkspaceFallback />;
  }

  return <BrowserWorkspaceApp />;
}

const subscribeToBrowser = () => () => {};
const getBrowserSnapshot = () => true;
const getServerSnapshot = () => false;

function BrowserWorkspaceApp() {
  return (
    // The bootstrap read runs before there is a session to read with, so this
    // lane carries the session-less meta. `ClientWorkspaceProvider` re-provides
    // the same lane with the real one once the user is known.
    <LaneProvider loaderMeta={NO_SESSION}>
      <React.Suspense fallback={<ClientOnlyWorkspaceFallback />}>
        <ClientOnlyWorkspaceBootstrap />
      </React.Suspense>
    </LaneProvider>
  );
}

function ClientOnlyWorkspaceBootstrap() {
  // The workspace's own read, not a restatement of it: the entry this seeds is
  // the one `useCurrentUser` reads later, because it is literally the same read.
  const currentUser = React.use(useLane(workspaceReads.currentUser()).promise)
    .data;

  return (
    <ClientWorkspaceProvider
      initialUser={currentUser}
      initialTeamId={currentUser.defaultTeamId}
    >
      <ClientOnlyWorkspace />
    </ClientWorkspaceProvider>
  );
}

function ClientOnlyWorkspace() {
  const { isSignedIn } = useWorkspace();
  const view = useLocalWorkspaceView();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <WorkspaceShell view={view} />;
}

function useLocalWorkspaceView(): WorkspaceViewController {
  const [filters, setFiltersState] = React.useState<TaskFilters>({
    ...EMPTY_FILTERS,
  });
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    null,
  );
  const [isPending, startTransition] = React.useTransition();

  const setFilters = React.useCallback((nextFilters: TaskFilters) => {
    startTransition(() => {
      setFiltersState(nextFilters);
    });
  }, []);

  const patchFilters = React.useCallback((patch: Partial<TaskFilters>) => {
    startTransition(() => {
      setFiltersState((current) => ({ ...current, ...patch }));
    });
  }, []);

  const resetFilters = React.useCallback(() => {
    startTransition(() => {
      setFiltersState({ ...EMPTY_FILTERS });
    });
  }, []);

  const selectTask = React.useCallback((taskId: string | null) => {
    startTransition(() => {
      setSelectedTaskId(taskId);
    });
  }, []);

  return {
    filters,
    isPending,
    patchFilters,
    resetFilters,
    selectTask,
    selectedTaskId,
    setFilters,
  };
}

function ClientOnlyWorkspaceFallback() {
  return (
    <div
      data-testid="lane-spa-workspace-shell"
      aria-label="Loading Lane SPA workspace"
      className="h-screen bg-background"
    />
  );
}
