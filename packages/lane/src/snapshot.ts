import type { LaneKey, LaneKeyOf, LanePlainKey, LaneSnapshot } from "./types";

/**
 * Pair an entry with the value seeded under it, checked — one entry of the
 * {@link LaneHydrationSnapshots} an RSC route (or router loader) hands to
 * `<LaneHydration>`: `laneSnapshot(taskLanes.detail(id), task)`.
 *
 * Anything with a `key` works — a read from {@link laneRead} or a bare
 * {@link LaneKeyOf} — so the seed is written against the definition the browser
 * reads with; no loader is called, so this is Server Component safe.
 *
 * **Seed only keys the client reads with `loader: external`.** Publishing
 * claims the key (weak retention, client mutations throw); a seeded key read
 * with a client loader has two owners, which warns in development from the
 * read (`readOrCreate` — the only place both halves are visible). A value the
 * client should own is published with `lane.set` instead. The checking is the
 * point: `LaneSnapshot.key` is a plain `LaneKey`, so a bare `{ key, data }`
 * literal would let any `data` through and hydrate every reader with the wrong
 * shape; taking a {@link LaneKeyOf} checks `data` against it.
 */
export function laneSnapshot<T>(
  target: LaneKeyOf<T> | { key: LaneKeyOf<T> },
  data: T,
): LaneSnapshot<T>;
/**
 * Bare plain key only (the value decides `T`, as with `lane.set`). Deliberately
 * no `{ key: LanePlainKey }` form: a read's `key` satisfies `LanePlainKey`, so
 * an object form would absorb every read and skip the checked overload above.
 */
export function laneSnapshot<T>(
  target: LanePlainKey,
  data: T,
): LaneSnapshot<T>;
export function laneSnapshot<T>(
  target: LaneKey | { key: LaneKey },
  data: T,
): LaneSnapshot<T> {
  return { data, key: "key" in target ? target.key : target };
}
