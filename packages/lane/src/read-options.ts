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
 * All three triggers share this one mapping, and coalescing across readers of
 * the same key falls out of the store rather than being computed centrally: the
 * first reader to fire refetches, and `onlyIf` makes the rest skip while that
 * load is in flight — so the smallest effective `staleTime` wins.
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
