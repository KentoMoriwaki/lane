import { publishEntry } from "./core";
import type { Lane, LaneHydrationSnapshots } from "./types";

/**
 * The publication write path: applying a payload of snapshots to a lane, and
 * keeping what it published alive for as long as the payload is.
 *
 * Separate from the store because it is a *policy* about where values come from
 * rather than a store primitive — everything seeded here is externally owned —
 * and separate from `hydration.ts` because none of it is React. An application
 * that never publishes never links it.
 */

/**
 * What a publication keeps alive, keyed by the payload it came from.
 *
 * An external entry holds its value weakly, so something has to be the strong
 * reference — and the honest answer to "how long should a published value live"
 * is "as long as whoever published it still has the payload". The framework
 * holding the RSC snapshots object is exactly that, so the tether hangs off it:
 * no lifetime of Lane's own to configure, no signal to keep in sync with the
 * router's own eviction, and the last reference disappears when the payload
 * does. (The other two are free: a committed reader keeps its promise in React
 * state, and a live read keeps it through its abort chain.)
 */
const publications = new WeakMap<LaneHydrationSnapshots, Promise<unknown>[]>();

/**
 * Applies server snapshots as authoritative values. Existing entries are
 * overwritten and their subscribers notified so that mounted readers converge
 * to the new data when a navigation re-hydrates the same keys.
 *
 * Everything seeded here becomes an **external** entry: the value is a copy of
 * something the publisher holds, so the client mutation surface is closed on it
 * (`lane.set` / `update` / `invalidate` / `remove` throw) and its retention
 * follows the payload rather than `gcTime`. A key the client is meant to own is
 * a key it should not be seeded with — read it with its own loader instead.
 *
 * The marking happens *before* the value is written, and that order is load
 * bearing: `setEntryCache` records a fulfilled value as the entry's
 * `lastFulfilled` unless the entry is already external, and that record is a
 * **strong** reference. A publication lands before any reader of its key renders
 * — the boundary suspends until it has — so leaving the marking to the reader's
 * own `readOrCreate` would let every seed be pinned by the entry that is
 * supposed to be holding it weakly, and the sweep never reclaims an external
 * entry to undo it.
 *
 * Which is also why the seed cannot wait and see whether a reader declares
 * `external`: by the time one does, the value is already recorded. The rule has
 * to be stated by the payload instead — seed only what the client reads with
 * `loader: external` — and the read is where a mismatch is reported (see
 * `readOrCreate`).
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
    // The same payload applied to a second lane. Both lanes' copies hang off the
    // one payload, which is exactly what "as long as the publisher holds it"
    // means when there is more than one reader of it.
    tethered.push(...published);
    return;
  }

  publications.set(snapshots, published);
}

/**
 * The promises a publication is holding alive. Test seam for the tether above —
 * reachability is what the design turns on, and this is the only way to assert
 * it without waiting on a collector.
 */
export function publishedBy(
  snapshots: LaneHydrationSnapshots,
): readonly Promise<unknown>[] | undefined {
  return publications.get(snapshots);
}
