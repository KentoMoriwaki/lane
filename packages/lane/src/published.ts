"use client";

import * as React from "react";

/**
 * What a hydration published, keyed by key id — the promise each seeded entry
 * now holds.
 */
export type LanePublished = Map<string, Promise<unknown>>;

/**
 * The handoff from `LaneHydration` to the readers under it.
 *
 * Publishing notifies subscribers, and notification is the only channel Lane has
 * to a mounted reader — so a reader with no subscription hears nothing. A hidden
 * `<Activity>` is exactly that: its effects are torn down, so fresh server data
 * lands in the lane while the reader holding the old data never learns of it.
 * Handing the values down instead reaches it, because it still *renders* under
 * this provider.
 *
 * A context rather than a store lookup, and that is the whole reason this can be
 * acted on during render: every reader under one hydration sees the same value in
 * the same pass, so none can adopt ahead of another. Reading the store here would
 * be per-reader and per-moment, which is how a revealed reader ends up overtaking
 * a subscribed one on the same key.
 *
 * Its own module, and its own context, so that a read hook can consume it without
 * importing `LaneHydration` — an app that never hydrates pays for the context and
 * nothing else.
 */
export const LanePublishedContext = React.createContext<
  LanePublished | undefined
>(undefined);

export function usePublished(): LanePublished | undefined {
  return React.useContext(LanePublishedContext);
}
