"use client";

import { createStore, Provider, useAtomValue } from "jotai";
import * as React from "react";
import {
  activeTeamIdAtom,
  bootstrapUserAtom,
  currentUserAtom,
  userIdAtom,
} from "@/app/jotai/api/atoms";
import { WorkspaceTransitionProvider } from "@/app/jotai/api/workspace-transition";
import { Workspace } from "./workspace";

/**
 * The jotai variant is client-owned, like `/lane-spa` and `/relay`: every read
 * happens in the browser. An is-client gate keeps the atoms from reading during
 * SSR — the server HTML and the first client render are the same blank shell,
 * so there is no hydration mismatch — and lets first paint show the Suspense
 * skeletons the variant is meant to demonstrate.
 */
export function JotaiWorkspaceApp() {
  const isClient = useIsClient();

  if (!isClient) {
    return <WorkspaceBootFallback />;
  }

  return (
    <Provider>
      <React.Suspense fallback={<WorkspaceBootFallback />}>
        <WorkspaceBootstrap />
      </React.Suspense>
    </Provider>
  );
}

/**
 * Session bootstrap. Reads `/api/me` with no session headers, then hands the
 * answer to a store that is seeded *before* it is mounted: the identity atoms
 * hold the real ids, and the response is published into `currentUserAtom` the
 * same way a mutation publishes one, so the workspace opens without asking for
 * the same user twice. Seeding a store up front is jotai's hydration story —
 * the equivalent of the snapshot the RSC-seeded `/lane` route ships.
 */
function WorkspaceBootstrap() {
  const user = useAtomValue(bootstrapUserAtom);
  const [store] = React.useState(() => {
    const seeded = createStore();
    seeded.set(userIdAtom, user.id);
    seeded.set(activeTeamIdAtom, user.defaultTeamId);
    seeded.set(currentUserAtom, { type: "set", value: user });
    return seeded;
  });

  return (
    <Provider store={store}>
      <WorkspaceTransitionProvider>
        <Workspace />
      </WorkspaceTransitionProvider>
    </Provider>
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
