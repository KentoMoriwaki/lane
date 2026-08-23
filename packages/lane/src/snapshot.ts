import type { LaneKey, LaneKeyOf, LanePlainKey, LaneSnapshot } from "./types";
// Type-only, so nothing of the hook's module (or its `"use client"`) comes
// with it: `infiniteLaneSnapshot` lives here to stay callable from a Server
// Component, which is the whole point of it.
import type { InfiniteLaneValue } from "./use-infinite-lane";

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

/**
 * The first page of an infinite list, as the value that key holds:
 * `infiniteLaneSnapshot(feedRead, firstPage, initialCursor)`.
 *
 * An infinite key holds `{ pages, params, hasNext }` whoever filled it, so a
 * route publishing page 1 has to publish that shape — and **this is the only
 * place the conversion happens**. The store stores what it is given and the
 * read reads what is stored; a page-to-list conversion anywhere else would be a
 * second answer to "what is under this key".
 *
 * `hasNext` is the read's own `nextCursor` applied to the page, so the browser
 * and the route agree about whether there is more before a single client fetch
 * has run. Isomorphic, like `laneSnapshot` — no loader is called, and none of
 * this touches React.
 */
export function infiniteLaneSnapshot<P, C>(
  read: {
    key: LaneKeyOf<InfiniteLaneValue<P, C>>;
    nextCursor: (page: P, cursor: C) => C | null;
  },
  firstPage: P,
  initialCursor: C,
): LaneSnapshot<InfiniteLaneValue<P, C>> {
  return laneSnapshot(read, {
    hasNext: read.nextCursor(firstPage, initialCursor) !== null,
    pages: [firstPage],
    params: [initialCursor],
  });
}
