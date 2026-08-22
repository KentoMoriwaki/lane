import { warnDev } from "./core";
import type { LaneReadOptions } from "./core";
import type {
  LaneInvalidateOptions,
  LaneLoaderMeta,
  LaneUseOptions,
} from "./types";

/**
 * The subset of a read's options that reaches `readOrCreate`, with the meta
 * resolved: the read's `loaderMeta` wins over the lane's (an absent override
 * means "use the lane's"). `fallback` is a separate argument because it is
 * typed by the read's `T`, which `LaneUseOptions` does not carry.
 */
export function toReadOptions(
  options: LaneUseOptions & { merge?: LaneReadOptions["merge"] },
  loaderMeta: LaneLoaderMeta,
  fallback?: LaneReadOptions["fallback"],
): LaneReadOptions {
  return {
    loaderMeta: options.loaderMeta ?? loaderMeta,
    // Not a public read option: only `useInfiniteLane` sets one, and it sets
    // it on the spec it builds for `useLane` (see use-infinite-lane.ts).
    merge: options.merge,
    warmTime: options.warmTime,
    fallback,
  };
}

/**
 * Translate a revalidation trigger (`refetchOnMount` / `refetchOnFocus` /
 * `refetchOnReconnect`) into the conditional invalidation a reader fires, or
 * `undefined` when off. Triggers refresh only stale values; `staleTime` says
 * which, and doubles as the rate limit. There is deliberately no "refresh
 * regardless of freshness" form: the read runs during render but the trigger
 * fires from an effect, so it would refetch what that same mount just loaded —
 * use `staleTime: 0`, or `lane.invalidate(key, { onlyIf: "settled" })`.
 * Coalescing falls out of the store: the first reader to fire refetches,
 * `onlyIf` makes the rest skip while it is in flight.
 */
export function revalidateOptions(
  trigger: boolean | undefined,
  staleTime: number | undefined,
): LaneInvalidateOptions | undefined {
  if (!trigger) {
    return undefined;
  }

  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    staleTime === undefined
  ) {
    warnDev(
      "A revalidation trigger (`refetchOnMount` / `refetchOnFocus` / " +
        "`refetchOnReconnect`) is on, which refreshes only stale values — but " +
        "`staleTime` defaults to Infinity, so nothing is ever stale and the " +
        "trigger never fires. Set a `staleTime` to say how long a value stays " +
        'fresh; `staleTime: 0` means "refresh on every mount / focus / reconnect".',
    );
  }

  return { onlyIf: "stale", staleTime };
}
