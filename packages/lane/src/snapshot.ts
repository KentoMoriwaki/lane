import type { LaneKey, LaneKeyOf, LanePlainKey, LaneSnapshot } from "./types";

/**
 * Pair an entry with the value seeded under it, checked — one entry of the
 * {@link LaneHydrationSnapshots} an RSC route (or a router loader) hands to
 * `<LaneHydration>`.
 *
 * ```tsx
 * const snapshots = {
 *   entries: [
 *     laneSnapshot(taskLanes.list(filters), tasks),
 *     laneSnapshot(taskLanes.detail(id), task),
 *   ],
 * };
 *
 * <LaneHydration snapshots={snapshots}>{children}</LaneHydration>
 * ```
 *
 * **It takes a read, not just a key.** Anything with a `key` works — a read from
 * {@link laneRead}, an infinite read, or a bare {@link LaneKeyOf} — so the seed is
 * written against the same definition the browser reads with, rather than a
 * key restated for the server. Reads are plain objects with no loader called
 * here, so this stays an ordinary Server Component import.
 *
 * The checking is the point. `LaneSnapshot.key` is a plain `LaneKey`, so an
 * object literal (`{ key, data }`) lets any `data` through: a mismatched pair on
 * this path does not fail a fetch, it hydrates every reader of that key with the
 * wrong shape and surfaces somewhere else entirely. Taking a {@link LaneKeyOf}
 * infers `T` from the key and checks `data` against it.
 *
 * A plain key carries no type, so — exactly as with `lane.set` — the value
 * decides it, and the second overload keeps that case working unchanged.
 */
export function laneSnapshot<T>(
  target: LaneKeyOf<T> | { key: LaneKeyOf<T> },
  data: T,
): LaneSnapshot<T>;
/**
 * A bare plain key only. It deliberately does *not* also accept `{ key:
 * LanePlainKey }`: a read's `key` is `LaneKey & LaneKeyOf<T>`, whose `LaneKey`
 * half alone satisfies `LanePlainKey`, so an object form here would absorb every
 * read and let the overload above be skipped — `data` would then be checked
 * against nothing. Reads are always tagged (that is what `laneRead` returns), so
 * requiring the array form loses no case.
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
