"use client";

import * as React from "react";
import { hydrateMany } from "./hydrate";
import { useLaneInstance } from "./provider";
import type { Lane, LaneHydrationSnapshots } from "./types";

const hydrationResources = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, Promise<void>>
>();

/**
 * The lineage of publications this subtree was last rendered under.
 * Notification cannot reach a reader with no live subscription (a hidden
 * `<Activity>`), so this context is the render-carried announcement: `useLane`
 * keeps the value it rendered under in state and re-reads the store on the
 * render where it changed — inside the navigating transition, so adoption
 * commits with it in one pass, no fallback in between.
 *
 * Only an external read consumes it (`useLane` calls `use` conditionally), so
 * republishes cannot re-render client-loader reads. It is a chain, not the
 * nearest boundary's snapshots: boundaries nest, and the identity must change
 * when *any* ancestor publishes; readers compare identity only.
 */
export type LaneHydrationSource = {
  snapshots: LaneHydrationSnapshots;
  parent: LaneHydrationSource | undefined;
};

export const LaneHydrationSourceContext = React.createContext<
  LaneHydrationSource | undefined
>(undefined);

/**
 * Seeds the lane from server snapshots, and **suspends until it has**.
 *
 * Seeding must notify mounted readers, and a `setState` dispatched from
 * another component's render is dropped — so the work is deferred. An effect
 * is too late: notifying after commit would land a navigation on the old
 * screen and deliver the data in a second transition (a flicker, and a pending
 * signal that lied). Suspending holds the transition open: hydration publishes
 * from the macrotask below and everything commits once with the new data.
 */
export function LaneHydration({
  snapshots,
  children,
}: {
  snapshots: LaneHydrationSnapshots;
  children: React.ReactNode;
}) {
  const lane = useLaneInstance();
  const parent = React.useContext(LaneHydrationSourceContext);
  const source = React.useMemo(
    () => ({ parent, snapshots }),
    [parent, snapshots],
  );

  React.use(getHydrationPromise(lane, snapshots));

  return React.createElement(
    LaneHydrationSourceContext.Provider,
    { value: source },
    children,
  );
}

function getHydrationPromise(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): Promise<void> {
  let resourcesByLane = hydrationResources.get(snapshots);

  if (!resourcesByLane) {
    resourcesByLane = new WeakMap();
    hydrationResources.set(snapshots, resourcesByLane);
  }

  const existing = resourcesByLane.get(lane);

  if (existing) {
    return existing;
  }

  const promise = createHydrationPromise(lane, snapshots);
  resourcesByLane.set(lane, promise);
  return promise;
}

function createHydrationPromise(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        hydrateMany(lane, snapshots);
        resolve();
      } catch (error) {
        reject(error);
      }
    }, 0);
  });
}
