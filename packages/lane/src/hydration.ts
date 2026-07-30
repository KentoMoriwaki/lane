"use client";

import * as React from "react";
import { hydrateMany } from "./core";
import { LanePublishedContext, usePublished } from "./published";
import type { LanePublished } from "./published";
import { useLaneInstance } from "./provider";
import type { Lane, LaneHydrationSnapshots } from "./types";

const hydrationResources = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, Promise<LanePublished>>
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
  const inherited = usePublished();
  const published = React.use(getHydrationPromise(lane, snapshots));
  // Added *to* what an outer boundary handed down, not replacing it, because
  // boundaries nest — a layout seeds some keys and a page seeds others — and a
  // reader is under all of them at once. Replacing would hide the outer seeding
  // from every reader below the inner one, which is exactly the reader that
  // cannot see it any other way. On a key both carry, the inner wins: it is the
  // one that published last, since it suspends inside the outer's children.
  const value = React.useMemo(
    () => (inherited ? new Map([...inherited, ...published]) : published),
    [inherited, published],
  );

  return React.createElement(LanePublishedContext, { value }, children);
}

function getHydrationPromise(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): Promise<LanePublished> {
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
): Promise<LanePublished> {
  return new Promise<LanePublished>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(hydrateMany(lane, snapshots));
      } catch (error) {
        reject(error);
      }
    }, 0);
  });
}
