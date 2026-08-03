"use client";

import {
  QueryClientProvider,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import * as React from "react";
import { currentUserQueryOptions } from "@/app/react-query/api/query-options";
import { getQueryClient } from "@/app/react-query/get-query-client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workspace } from "./workspace";
import { WorkspaceLoadingShell } from "./workspace-loading-shell";
import { WorkspaceProvider } from "./workspace-provider";

const subscribeToBrowser = () => () => {};
const getBrowserSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Keep workspace data out of both the RSC payload and the prerendered HTML.
 * The server and hydration render agree on the static shell; React then mounts
 * the browser-owned QueryClient and starts the API reads.
 */
export function ClientOnlyReactQueryWorkspace() {
  const isBrowser = React.useSyncExternalStore(
    subscribeToBrowser,
    getBrowserSnapshot,
    getServerSnapshot,
  );

  if (!isBrowser) {
    return <WorkspaceLoadingShell />;
  }

  return <BrowserWorkspace />;
}

function BrowserWorkspace() {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200} skipDelayDuration={400}>
        <React.Suspense fallback={<WorkspaceLoadingShell />}>
          <WorkspaceBootstrap />
        </React.Suspense>
        <Toaster />
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}

function WorkspaceBootstrap() {
  const { data: currentUser } = useSuspenseQuery(
    currentUserQueryOptions({ userId: "", teamId: "" }),
  );

  return (
    <WorkspaceProvider
      initialUser={currentUser}
      initialTeamId={currentUser.defaultTeamId}
    >
      <Workspace />
    </WorkspaceProvider>
  );
}
