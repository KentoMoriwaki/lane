import type {
  LaneExternalLoader,
  LaneExternalReadSpec,
  LaneGatedExternalReadSpec,
  LaneGatedReadSpec,
  LaneKeyOf,
  LaneReadSpec,
} from "./types";

/**
 * Colocate a read's key, loader, and options into one value that every consumer
 * accepts — Lane's answer to react-query's `queryOptions()`.
 *
 * ```ts
 * export const taskLanes = {
 *   detail: (id: string) =>
 *     laneRead({
 *       key: ["task", id],
 *       loader: ({ signal }) => fetchTask(id, signal),
 *       staleTime: 60_000,
 *     }),
 * };
 *
 * const { promise } = useLane(taskLanes.detail(id));  // reads
 * lane.prefetch(taskLanes.detail(id));                // warms
 * lane.invalidate(taskLanes.detail(id).key);          // converges
 * lane.set(taskLanes.detail(task.id).key, task);      // publishes, checked
 * ```
 *
 * The reads take the whole definition; the entry operations take only its `key`,
 * which is where the loaded type lives.
 *
 * At runtime this returns the object it was given. Its entire job is types, and
 * there are two of them:
 *
 * 1. **Inference, and a key that carries it.** `T` comes from the loader's
 *    return type, so a read is fully typed the moment it is defined — and the
 *    `key` it hands back is a {@link LaneKeyOf}, a key that knows what its entry
 *    holds. That is what reaches the *write* side: `lane.set(spec.key, value)`
 *    is checked, where a plain key carries no type and can check nothing.
 *
 *    The type travels on the key rather than on the read because publishing,
 *    invalidating, and removing address an entry — none of them needs a loader,
 *    so none of them should have to import one (or the context one would need).
 *    `prefetch` is the exception, and takes the whole read, because it is the one
 *    operation that performs one.
 * 2. **A checked shape.** A bare object literal is checked only against whatever
 *    the consumer's parameter happens to be; `laneRead` checks it where it is
 *    written, so a typo in an option name is an error at the definition rather
 *    than a silently ignored property at three call sites.
 *
 * `C` — the type of `current` — still defaults to `T` and still has to be given
 * explicitly (`laneRead<Feed, Cursor>({ … })`) for a loader whose `current` is
 * deliberately narrower or wider than its result. Reading `current` without an
 * annotation is the same type error it is on `useLane`, not a silent `any`.
 *
 * There is no runtime registry behind a spec: two calls to the same factory
 * produce two objects with equal keys, and Lane addresses entries by serialized
 * key, so they name the same read. Specs can be built per render, in an event
 * handler, or on the server; nothing has to be memoized for identity.
 *
 * A read of a key somebody else publishes is written the same way, with
 * `external` in the loader slot: `laneRead<Task>({ key, loader: external })`.
 * Nothing is inferred from that loader — it loads nothing — so `T` is annotated,
 * and the shape accepts nothing else: every option here instructs a loader, and
 * that read has none. Its overload comes first, so a spec whose loader is
 * `external` is described by that shape rather than by the general one.
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
 * Gated external — `loader: enabled ? external : undefined`. Last of the four,
 * because its loader type also admits a bare `undefined`, and a gated *client*
 * read written with no loader at all must keep landing on the overload above.
 */
export function laneRead<T>(
  spec: LaneGatedExternalReadSpec<T>,
): { key: LaneKeyOf<T>; loader: LaneExternalLoader | undefined };
export function laneRead<T, C = T>(
  spec: LaneGatedReadSpec<T, C> | LaneGatedExternalReadSpec<T>,
):
  | (LaneGatedReadSpec<T, C> & { key: LaneKeyOf<T> })
  | (LaneGatedExternalReadSpec<T> & { key: LaneKeyOf<T> }) {
  // The tag is a type-level assertion about the key, so the value passes
  // through untouched; only the signature above changes what callers see.
  return spec as LaneGatedReadSpec<T, C> & { key: LaneKeyOf<T> };
}
