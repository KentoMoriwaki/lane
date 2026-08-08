import { publishEntry } from "./core";
import type { Lane, LaneHydrationSnapshots } from "./types";

// The publication write path, kept apart from the store (policy, not
// primitive) and from hydration.ts (none of it is React).

// External entries hold their values weakly, so the payload object is the
// strong reference: a published value lives exactly as long as its publisher
// holds the payload — no lifetime of Lane's own to configure.
const publications = new WeakMap<LaneHydrationSnapshots, Promise<unknown>[]>();

/**
 * Applies server snapshots as authoritative values. Existing entries are
 * overwritten and subscribers notified, so mounted readers converge when a
 * navigation re-hydrates the same keys.
 *
 * Everything seeded becomes an **external** entry: client mutations throw, and
 * retention follows the payload rather than `gcTime`. Marking must happen
 * *before* the value is written: `setEntryCache` records a fulfilled value as
 * a strong `lastFulfilled` unless the entry is already external, so deferring
 * the marking to the reader's own read would pin every seed strongly. A
 * seed/loader mismatch is reported at the read (see `readOrCreate`).
 */
export function hydrateMany(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): void {
  const published = snapshots.entries.map((snapshot) =>
    publishEntry(lane, snapshot.key, snapshot.data, true),
  );
  const tethered = publications.get(snapshots);

  if (tethered) {
    // Same payload applied to a second lane: both lanes' copies hang off it.
    tethered.push(...published);
    return;
  }

  publications.set(snapshots, published);
}

/** The promises a publication holds alive — test seam for asserting reachability. */
export function publishedBy(
  snapshots: LaneHydrationSnapshots,
): readonly Promise<unknown>[] | undefined {
  return publications.get(snapshots);
}
