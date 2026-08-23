import { publishEntry } from "./core";
import type { Lane, LaneHydrationSnapshots } from "./types";

// The publication write path, kept apart from the store (policy, not
// primitive) and from hydration.ts (none of it is React).

// External entries hold their values weakly, so the payload object is the
// strong reference: a published value lives exactly as long as its publisher
// holds the payload — no lifetime of Lane's own to configure. A client write
// onto a published key takes the same seat in the same bucket, so it lives
// exactly as long as the publication it overwrote.
const publications = new WeakMap<LaneHydrationSnapshots, Promise<unknown>[]>();

/**
 * Applies server snapshots as authoritative values. Existing entries are
 * overwritten and subscribers notified, so mounted readers converge when a
 * navigation re-hydrates the same keys.
 *
 * Everything seeded becomes an **external** entry: retention follows the
 * payload rather than `gcTime`. Marking must happen *before* the value is
 * written: `setEntryCache` records a fulfilled value as a strong
 * `lastFulfilled` unless the entry is already external, so deferring the
 * marking to the reader's own read would pin every seed strongly. A
 * seed/loader mismatch is reported at the read (see `readOrCreate`).
 */
export function hydrateMany(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): void {
  // Same payload applied to a second lane: both lanes' copies hang off it.
  let bucket = publications.get(snapshots);

  if (!bucket) {
    bucket = [];
    publications.set(snapshots, bucket);
  }

  for (const snapshot of snapshots.entries) {
    // The bucket goes in with the value: the entry takes a seat in it, the
    // published promise sits there, and every client write to the key from
    // here on takes that same seat.
    publishEntry(lane, snapshot.key, snapshot.data, bucket);
  }
}

/**
 * What a publication holds alive: one promise per key it published, replaced in
 * place when the client writes over that key — test seam for asserting
 * reachability.
 */
export function publishedBy(
  snapshots: LaneHydrationSnapshots,
): readonly Promise<unknown>[] | undefined {
  return publications.get(snapshots);
}
