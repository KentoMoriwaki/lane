"use client";

import * as React from "react";
import { hydrateMany } from "./core";
import { useLaneInstance } from "./provider";
import type { Lane, LaneHydrationSnapshots } from "./types";

const hydrationResources = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, Promise<void>>
>();

/**
 * Seeds the lane from server snapshots, and **suspends until it has**.
 *
 * The suspension is the mechanism, not a side effect of one. Seeding has to be
 * announced — a re-hydration must reach readers that are already mounted, and
 * notification is Lane's only channel to them — and announcing means a
 * subscriber's `setState`, which React drops when it is dispatched from another
 * component's render pass. So the work cannot happen during this render, and the
 * question is only where it goes instead.
 *
 * Anywhere *after* commit is wrong, and this is the part worth spelling out: a
 * navigation renders this boundary inside the router's transition. Notifying from
 * an effect would let that transition commit first — with every mounted reader
 * still holding its previous promise, so the navigation lands on the old screen,
 * the router's pending state ends, and the data then arrives in a second,
 * unrelated transition. One user-visible flicker, and a pending signal that lied.
 *
 * Suspending instead holds the transition open: React keeps the current screen
 * live, hydration publishes and notifies from the macrotask below, the readers'
 * updates join the work already in progress, and the whole thing commits **once**,
 * with the new data. That is the same property every other Lane read has, and it
 * is why hydration is deferred by a timer rather than by an effect.
 */
export function LaneHydration({
  snapshots,
  children,
}: {
  snapshots: LaneHydrationSnapshots;
  children: React.ReactNode;
}) {
  const lane = useLaneInstance();

  React.use(getHydrationPromise(lane, snapshots));

  return children;
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
