import { warnDev } from "./core";
import type { LaneReadOptions } from "./core";
import type {
  LaneInvalidateOptions,
  LaneLoaderMeta,
  LaneUseOptions,
} from "./types";

/**
 * The subset of a read's options that reaches `readOrCreate`, with the meta
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
  return { loaderMeta: options.loaderMeta ?? loaderMeta };
}

/**
 * Translate a revalidation trigger (`refetchOnMount` / `refetchOnFocus` /
 * `refetchOnReconnect`) into the conditional invalidation a reader fires, or
 * `undefined` when the trigger is off. A trigger refreshes stale values, and
 * `staleTime` is what says which those are.
 *
 * There is deliberately no "refresh regardless of freshness" form. It read as a
 * convenience and behaved as a trap: the same spelling in react-query costs
 * nothing on a fresh mount, because a mount fetch and a stale refetch are one
 * mechanism there. Here they are two — the read runs during render, the trigger
 * fires from an effect — so it also refetched the value that same mount had just
 * loaded. `staleTime: 0` expresses the same intent without hiding the cost, and
 * `lane.invalidate(key, { onlyIf: "settled" })` remains for an unconditional
 * refresh an app schedules itself.
 *
 * All three triggers share this one mapping, and coalescing across readers of
 * the same key falls out of the store rather than being computed centrally: the
 * first reader to fire refetches, and `onlyIf` makes the rest skip while that
 * load is in flight — so the smallest effective `staleTime` wins.
 *
 * `staleTime` is also the rate limit on the trigger it gates: a value refreshed
 * within it is not refreshed again, however many times the trigger fires. That is
 * why a trigger without one is a misconfiguration rather than a shorthand — see
 * the warning below.
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
