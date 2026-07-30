import { warnDev } from "./core";
import type { LaneReadOptions } from "./core";
import type {
  LaneInvalidateOptions,
  LaneLoaderMeta,
  LaneUseOptions,
} from "./types";

/**
 * The fetch-shaping subset a read passes to `readOrCreate`, with the meta
 * resolved: the read's own `loaderMeta` where it sets one, the lane's otherwise.
 *
 * The lane's value is a second argument rather than a field of `options` because
 * it does not come from the read — the read carries what it was defined with, the
 * lane carries what its loaders are handed. The read wins because it is the more
 * specific of the two, and it can only ever narrow: the lane's value is
 * guaranteed to exist, so an absent override is "use the lane's", never "there
 * isn't one".
 */
export function toReadOptions(
  options: LaneUseOptions,
  loaderMeta: LaneLoaderMeta,
): LaneReadOptions {
  return {
    loaderMeta: options.loaderMeta ?? loaderMeta,
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
 *
 * `staleTime` is also the rate limit on the trigger it gates: a value refreshed
 * within it is not refreshed again, however many times the trigger fires. That is
 * why `true` without one is a misconfiguration rather than a shorthand — see the
 * warning below.
 */
export function revalidateOptions(
  trigger: boolean | "always" | undefined,
  staleTime: number | undefined,
): LaneInvalidateOptions | undefined {
  if (!trigger) {
    return undefined;
  }

  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    trigger === true &&
    staleTime === undefined
  ) {
    warnDev(
      "A revalidation trigger (`refetchOnMount` / `refetchOnFocus` / " +
        "`refetchOnReconnect`) is `true`, which refreshes only stale values — but " +
        "`staleTime` defaults to Infinity, so nothing is ever stale and the " +
        "trigger never fires. Set a `staleTime` to say how long a value stays " +
        'fresh, or use "always" to refresh regardless of freshness.',
    );
  }

  return trigger === "always"
    ? { onlyIf: "settled" }
    : { onlyIf: "stale", staleTime };
}
