"use client";

import { LaneProvider, useLane } from "use-lane";
import * as React from "react";
import { fetchCurrentUser } from "@/api/endpoints";
import { EMPTY_FILTERS, type TaskFilters } from "@/api/endpoints";
import { queryKeys } from "@/api/query-options";
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
  return (
    <LaneProvider>
      <React.Suspense fallback={<ClientOnlyWorkspaceFallback />}>
        <ClientOnlyWorkspaceBootstrap />
      </React.Suspense>
    </LaneProvider>
  );
}

function ClientOnlyWorkspaceBootstrap() {
  const currentUser = React.use(
    useLane(queryKeys.currentUser, () =>
      fetchCurrentUser({ userId: "", teamId: "" }),
    ).promise,
  );

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
  return <div className="h-screen bg-background" />;
}
