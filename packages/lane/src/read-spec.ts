import type {
  LaneExternalLoader,
  LaneExternalReadSpec,
  LaneGatedExternalReadSpec,
  LaneGatedReadSpec,
  LaneKeyOf,
  LaneReadSpec,
} from "./types";

/**
 * Colocate a read's key, loader, and options into one value every consumer
 * accepts — Lane's answer to react-query's `queryOptions()`.
 *
 * ```ts
 * const detail = (id: string) =>
 *   laneRead({ key: ["task", id], loader: ({ signal }) => fetchTask(id, signal) });
 * ```
 *
 * At runtime it returns the object it was given; its job is types. `T` is
 * inferred from the loader, and the returned `key` is a {@link LaneKeyOf}, so
 * writes through it are checked. The type travels on the key because entry
 * operations should not have to import a loader (`prefetch` alone takes the
 * whole read). The spec is checked where it is written, so an option typo
 * errors at the definition, not at call sites. `C` — the type of `current` —
 * defaults to `T` and must be given explicitly when it differs. No runtime
 * registry: entries are addressed by serialized key, so equal-keyed specs name
 * the same read and nothing needs memoizing. An externally published key is
 * read with `laneRead<Task>({ key, loader: external })` — `T` annotated
 * (nothing is inferred from a loader that loads nothing), no loader options;
 * that overload comes first so it wins.
 */
export function laneRead<T>(
  spec: LaneExternalReadSpec<T>,
): { key: LaneKeyOf<T>; loader: LaneExternalLoader };
export function laneRead<T, C = T>(
  spec: LaneReadSpec<T, C>,
): LaneReadSpec<T, C> & { key: LaneKeyOf<T> };
export function laneRead<T, C = T>(
  spec: LaneGatedReadSpec<T, C>,
): LaneGatedReadSpec<T, C> & { key: LaneKeyOf<T> };
/**
 * Gated external — `loader: enabled ? external : undefined`. Last of the four:
 * its loader type also admits a bare `undefined`, and a gated *client* read
 * with no loader must keep landing on the overload above.
 */
export function laneRead<T>(
  spec: LaneGatedExternalReadSpec<T>,
): { key: LaneKeyOf<T>; loader: LaneExternalLoader | undefined };
export function laneRead<T, C = T>(
  spec: LaneGatedReadSpec<T, C> | LaneGatedExternalReadSpec<T>,
):
  | (LaneGatedReadSpec<T, C> & { key: LaneKeyOf<T> })
  | (LaneGatedExternalReadSpec<T> & { key: LaneKeyOf<T> }) {
  // The key tag is type-level only; the value passes through untouched.
  return spec as LaneGatedReadSpec<T, C> & { key: LaneKeyOf<T> };
}
