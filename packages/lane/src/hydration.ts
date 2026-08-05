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
 *
 * Notification reaches every reader whose passive subscription is alive, but a
 * hidden `<Activity>` has none — and a revisit that re-streams a payload is
 * exactly a republish aimed at such a tree. The context is the render-carried
 * copy of that announcement: `useLane` keeps the value it rendered under in
 * state and, on the render where it changed, re-reads the store in that same
 * render (see its source-switch branch). The boundary below suspends until the
 * publish has landed, so by the time children render under a new value the
 * seeds are already in the store; and because that render happens inside
 * whatever transition is rendering the boundary — a navigation, typically —
 * the adoption commits with it, in one pass, with no fallback in between. That
 * is what keeps a framework's "fetch, then reveal" intact through Lane.
 *
 * **Only an external read consumes it.** `useLane` reads it with `use` under a
 * condition, so a read carrying a client loader never becomes a dependent fiber
 * and a publication does not re-render it — which is what keeps a boundary that
 * republishes on every navigation from reaching into reads it has nothing to say
 * about. The reasoning, and what an over-broad wake-up actually costs an
 * unsubscribed reader, is at that call site.
 *
 * The value is a chain rather than the nearest boundary's snapshots, because
 * boundaries nest and a reader's seeds may come from any ancestor: each
 * boundary links its snapshots to the value above it, so the identity a reader
 * compares changes when *any* boundary in its lineage publishes — an outer
 * republish is not hidden from readers sitting under a stable inner boundary.
 * The value is opaque to readers; only its identity means anything.
 *
 * Nothing about the mechanism needs the snapshots themselves — any token whose
 * identity changes per publication would do — carrying them is just the
 * smallest implementation. The cost is that a reader's `prevSource` state
 * retains the lineage it last rendered under, so a reader that has not
 * re-rendered (a hidden `<Activity>`, typically) keeps one superseded
 * generation of seed data reachable until its next render. That is bounded and
 * of the same order as what the kept tree already retains; if it ever shows in
 * a profile, swap the chain node for a WeakMap-derived epoch number — readers
 * compare identity only, so they would not change.
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
