"use client";

import * as React from "react";
import {
  RelayWorkspaceProvider,
  useWorkspace,
} from "@/app/relay/api/workspace-provider";
import { SignInScreen } from "./sign-in-screen";
import { RelayWorkspace } from "./workspace";

/**
 * The Relay variant is client-owned (like `/lane-spa`): every read happens in
 * the browser, so the workspace mounts only after hydration. Rendering the
 * Relay tree behind an is-client gate keeps the GraphQL fetches off the server —
 * the server HTML and the first client render are the same blank shell, so there
 * is no hydration mismatch — and lets first paint show the Suspense skeletons
 * and `@defer` streaming the variant exists to demonstrate.
 */
export function ClientOnlyWorkspaceApp() {
  const isClient = useIsClient();

  if (!isClient) {
    return <WorkspaceBootFallback />;
  }

  return (
    <RelayWorkspaceProvider>
      <WorkspaceGate />
    </RelayWorkspaceProvider>
  );
}

function WorkspaceGate() {
  const { isSignedIn } = useWorkspace();

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return (
    <React.Suspense fallback={<WorkspaceBootFallback />}>
      <RelayWorkspace />
    </React.Suspense>
  );
}

function useIsClient() {
  const [isClient, setIsClient] = React.useState(false);
  React.useEffect(() => {
    setIsClient(true);
  }, []);
  return isClient;
}

function WorkspaceBootFallback() {
  return <div className="h-screen bg-background" />;
}
