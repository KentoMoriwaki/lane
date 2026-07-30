"use client";

import * as React from "react";
import { hydrateMany } from "./core";
import { useLaneInstance } from "./provider";
import type { Lane, LaneHydrationSnapshots } from "./types";

// One seeding per (snapshots, lane): the value a server render produced is
// applied once however often the boundary re-renders, and a new instance — a new
// server render, a new loader result — is a new seeding, deliberately.
const seedings = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, { notify: (() => void) | undefined }>
>();

export function LaneHydration({
  snapshots,
  children,
}: {
  snapshots: LaneHydrationSnapshots;
  children: React.ReactNode;
}) {
  const lane = useLaneInstance();
  // Seeded during render, so `children` read fulfilled promises on their very
  // first render — no suspend, no fetch that a later publish would overwrite.
  const seeding = seedOnce(lane, snapshots);

  // The announcement is the half that cannot happen during render: a reader's
  // `setState` dispatched from this render pass is dropped. Mounted readers only
  // exist on a re-hydration, which is exactly when this matters.
  React.useEffect(() => {
    const notify = seeding.notify;
    seeding.notify = undefined;
    notify?.();
  }, [seeding]);

  return children;
}

function seedOnce(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): { notify: (() => void) | undefined } {
  let byLane = seedings.get(snapshots);

  if (!byLane) {
    byLane = new WeakMap();
    seedings.set(snapshots, byLane);
  }

  const existing = byLane.get(lane);

  if (existing) {
    return existing;
  }

  const seeding = { notify: hydrateMany(lane, snapshots) };
  byLane.set(lane, seeding);

  return seeding;
}
