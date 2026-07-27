export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

export type LaneLoaderContext = {
  key: LaneKey;
  signal: AbortSignal;
};

export type LaneLoader<T> = (context: LaneLoaderContext) => Promise<T>;

export type LaneRetryDelay = (attempt: number, error: unknown) => number;

export type LaneScope =
  | LaneKey
  | ((entry: { key: LaneKey; keyId: string }) => boolean);

export type LaneSnapshot<T = unknown> = {
  key: LaneKey;
  data: T;
};

export type LaneHydrationSnapshots = {
  entries: readonly LaneSnapshot[];
};

export type LaneEntryInfo = {
  key: LaneKey;
  keyId: string;
};

export type LaneUpdater<T> = (
  current: T,
  entry: LaneEntryInfo,
) => LaneValue<T>;

export type LaneInvalidateOptions = {
  onlyIf?: "stale" | "settled";
  staleTime?: number;
  /**
   * Converge through the background transition (surfaces as `isBackgroundPending`)
   * instead of the default explicit one (`isTransitionPending`). Use it for
   * automatic refreshes — e.g. a self-scheduled poll — so they don't read as a
   * user-driven invalidation.
   */
  background?: boolean;
  /**
   * Invalidate now, but hold the re-reads behind this promise. Readers go pending
   * immediately (still showing their current value through the transition) and
   * only fetch once `after` settles.
   *
   * This is the answer to the mutation window: `await action(); invalidate()`
   * cannot signal anything until the action finishes, because notification is the
   * only channel and it fires last. Passing the action as `after` moves the
   * notification to the start:
   *
   * ```ts
   * startTransition(async () => {
   *   const saved = saveTodo(patch);
   *   lane.invalidateAll(["todos"], { after: saved });
   *   await saved;
   * });
   * ```
   *
   * `after` decides *when* the reads run, never *whether* — a rejected action
   * leaves the key invalidated, so the next read still reflects whatever the
   * source actually holds. Only the settlement is observed; the value is ignored.
   */
  after?: Promise<unknown>;
};

/**
 * Options for `Lane.prefetch`. Only the fetch-shaping knobs apply — `staleTime`
 * / `whenStale` are read-time concerns the eventual reader decides, and prefetch
 * always uses `"revalidate"` so a repeat call dedupes onto the warm cache.
 */
export type LanePrefetchOptions = Pick<LaneUseOptions, "retry" | "retryDelay">;

export type Lane = {
  prefetch<T>(
    key: LaneKey,
    loader: LaneLoader<T>,
    options?: LanePrefetchOptions,
  ): Promise<LaneRead<T>>;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<LaneRead<T>>;
  update<T>(
    key: LaneKey,
    updater: LaneUpdater<T>,
  ): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
};

/**
 * What a read resolves to. `data` is the value; `refreshError` is present when
 * the most recent refresh failed while a previously fulfilled value is still
 * being served (stale-on-error). The error travels in the same resolved value
 * as the data it accompanies, so a reader sees both consistently through
 * `use(promise)` — no separate, render-time store read.
 */
export type LaneRead<T> = {
  data: T;
  refreshError?: unknown;
};

export type LaneResult<T> = {
  promise: Promise<LaneRead<T>>;
  isBackgroundPending: boolean;
  isTransitionPending: boolean;
  invalidate: (options?: LaneInvalidateOptions) => void;
};

/**
 * The shape `useLane` returns when the loader may be absent. Passing
 * `loader: undefined` gates the read off, so `promise` is `undefined` while
 * disabled (nothing is fetched, subscribed, or stored under the key). Unwrap it
 * conditionally — `result.promise ? use(result.promise) : fallback` — which is
 * allowed because `use` may be called inside conditionals.
 */
export type LaneGatedResult<T> = Omit<LaneResult<T>, "promise"> & {
  promise: Promise<LaneRead<T>> | undefined;
};

export type LaneWhenStale = "revalidate" | "refetch";

export type LaneRefetchOnMount = boolean | "always";

export type LaneRefetchOnFocus = boolean | "always";

export type LaneRefetchOnReconnect = boolean | "always";

export type LaneUseOptions = {
  staleTime?: number;
  /**
   * What a read does when the cached value is stale (older than `staleTime`):
   * - `"revalidate"` (default): reuse the cached value and let it be refreshed
   *   in the background (via `refetchOnMount`/focus/reconnect/poll) — the reader
   *   keeps showing it and converges to fresh through a transition.
   * - `"refetch"`: discard the stale value (or a prior error) and suspend on a
   *   fresh read. Never discards an in-flight read or a value a live subscriber
   *   is showing, so it only forces a fresh load on an otherwise idle remount.
   *
   * This is the read-time freshness behavior; `refetchOnMount`/focus/reconnect
   * decide *when* a background revalidation is triggered, independently.
   */
  whenStale?: LaneWhenStale;
  retry?: number;
  retryDelay?: LaneRetryDelay;
  refetchOnFocus?: LaneRefetchOnFocus;
  refetchOnMount?: LaneRefetchOnMount;
  refetchOnReconnect?: LaneRefetchOnReconnect;
};

/**
 * Construction-time options for a `Lane` instance.
 */
export type LaneOptions = {
  /**
   * How long (ms) an inactive entry (no subscribers) is retained before it is
   * garbage-collected. Idle-time based — unrelated to `staleTime`/freshness.
   * An instance-wide memory policy, not a per-read concern. Default 5 minutes;
   * `Infinity` opts out. Eviction is coalesced into one timer per lane, so the
   * exact moment is approximate (it never needs to be precise — a late eviction
   * just keeps the value reusable a little longer).
   */
  gcTime?: number;
};
