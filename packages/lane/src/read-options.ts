import type { LaneReadOptions } from "./core";
import type { LaneInvalidateOptions, LaneUseOptions } from "./types";

/** The fetch-shaping subset a read passes to `readOrCreate`. */
export function toReadOptions(options: LaneUseOptions): LaneReadOptions {
  return {
    retry: options.retry,
    retryDelay: options.retryDelay,
    staleTime: options.staleTime,
    whenStale: options.whenStale,
  };
}

/**
 * Translate a revalidation trigger (`refetchOnMount` / `refetchOnFocus` /
 * `refetchOnReconnect`) into the conditional invalidation a reader fires, or
 * `undefined` when the trigger is off. `"always"` refreshes any settled entry;
 * `true` refreshes only stale ones (older than `staleTime`).
 *
 * All three triggers share this one mapping — reached through
 * {@link triggerOptions}, which resolves the values first — and coalescing across
 * readers of the same key falls out of the store rather than being computed
 * centrally: the first reader to fire refetches, and `onlyIf` makes the rest skip
 * while that load is in flight — so the smallest effective `staleTime` wins.
 */
export function revalidateOptions(
  trigger: boolean | "always" | undefined,
  staleTime: number | undefined,
): LaneInvalidateOptions | undefined {
  if (!trigger) {
    return undefined;
  }

  return trigger === "always"
    ? { onlyIf: "settled" }
    : { onlyIf: "stale", staleTime };
}

/**
 * One revalidation trigger's conditional invalidation, resolved against the
 * lane's defaults — the fire-time twin of what `readOrCreate` does for the four
 * options core sees. Every reader-side trigger goes through here, so "a default
 * fills in an option a read did not specify" holds for all seven options rather
 * than only the ones the store happens to know about.
 *
 * The trigger and the `staleTime` it is judged against fall back independently,
 * which is what makes a lane-wide `staleTime` govern a read that only turned the
 * trigger on — and the reverse. `undefined` stays "unspecified" (`??`), so a read
 * opts out by writing the built-in (`refetchOnFocus: false`) rather than by
 * writing nothing.
 */
export function triggerOptions(
  defaults: LaneUseOptions | undefined,
  options: LaneUseOptions,
  trigger: "refetchOnFocus" | "refetchOnMount" | "refetchOnReconnect",
): LaneInvalidateOptions | undefined {
  return revalidateOptions(
    options[trigger] ?? defaults?.[trigger],
    options.staleTime ?? defaults?.staleTime,
  );
}
