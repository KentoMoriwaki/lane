"use client";

import * as React from "react";
import { hydrateMany } from "./core";
import { useLaneInstance } from "./provider";
import type { Lane, LaneHydrationSnapshots } from "./types";

const hydrationResources = new WeakMap<
  LaneHydrationSnapshots,
  WeakMap<Lane, Promise<void>>
>();

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
