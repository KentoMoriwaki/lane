import type { LaneGatedReadSpec, LaneReadSpec } from "./types";

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
 * const { promise } = useLane(taskLanes.detail(id)); // reads
 * lane.prefetch(taskLanes.detail(id));               // warms
 * lane.invalidate(taskLanes.detail(id));             // converges
 * lane.set(taskLanes.detail(task.id), task);         // publishes, type-checked
 * ```
 *
 * At runtime this returns the object it was given. Its entire job is types, and
 * there are two of them:
 *
 * 1. **Inference.** It infers `T` from the loader's return type, so a spec is
 *    fully typed the moment it is defined and every consumer reads that type
 *    back instead of re-inferring it. This is why `lane.set(spec, value)` can
 *    check the value at all — the type reaches the write side, which a key never
 *    does.
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
 */
export function laneRead<T, C = T>(spec: LaneReadSpec<T, C>): LaneReadSpec<T, C>;
export function laneRead<T, C = T>(
  spec: LaneGatedReadSpec<T, C>,
): LaneGatedReadSpec<T, C>;
export function laneRead<T, C = T>(
  spec: LaneGatedReadSpec<T, C>,
): LaneGatedReadSpec<T, C> {
  return spec;
}
