export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

export type LaneLoaderContext<C = unknown> = {
  key: LaneKey;
  signal: AbortSignal;
  /**
   * The entry's last fulfilled value, or `undefined` on a first load.
   *
   * Snapshotted when the read is created, so every retry of that read sees the
   * same value. It survives invalidation — invalidating clears the cached
   * promise, not the last fulfilled value — which is what lets a loader re-read
   * *as much as it already had* instead of only what its key describes: the
   * accumulated pages of a list, a cursor to resume from, a revision to send as
   * `If-None-Match`.
   *
   * It is `undefined` again once the entry itself is gone (removed, collected,
   * or invalidated while nothing was subscribed to hold it), so a loader must
   * always define what a first load means.
   *
   * It is deliberately *not* a way to skip work: the value is the previous
   * read's, and returning it unchanged would strand the entry on stale data with
   * no way to notice.
   *
   * **Its type is the read's second type parameter, defaulting to the loaded
   * type.** It cannot simply *be* the loaded type: that would put the loader's
   * own type parameter in the loader's *parameter* position, and TypeScript
   * fixes a type parameter before it checks a context-sensitive argument's body,
   * so `useLane(key, ({ signal }) => fetchTask(id, signal))` — the form the docs
   * recommend everywhere — would infer `LaneRead<unknown>` instead of
   * `LaneRead<Task>`. (`NoInfer` does not change that.) Keeping the loaded type
   * to the return position and `current` on its own parameter preserves
   * inference, and annotating the read types `current` with it:
   *
   * ```ts
   * useLane<Feed>(["feed"], async ({ current, signal }) => …);
   * //          ^ current is Feed | undefined
   * ```
   *
   * A loader that reads `current` without the annotation gets `{}` — a type
   * error asking for the annotation, not a silent `any`.
   */
  current: C | undefined;
};

/**
 * `T` is what the loader resolves to; `C` is what it sees in `current`, and
 * defaults to `T` because re-reading an entry almost always means producing the
 * same shape it already held. Give `C` explicitly only for a loader whose
 * `current` is deliberately narrower or wider than its result.
 */
export type LaneLoader<T, C = T> = (
  context: LaneLoaderContext<C>,
) => Promise<T>;

export type LaneRetryDelay = (attempt: number, error: unknown) => number;

/**
 * A read described in one place: the key, the loader that fills it, and the
 * options it is read with. Build one with {@link laneRead} and pass it wherever
 * a read is named — `useLane(spec)`, `useLanesAll([spec, …])`,
 * `lane.prefetch(spec)`, `lane.invalidate(spec)`, `lane.set(spec, value)`.
 *
 * Colocation is the point. A key defined in one module and a loader in another
 * are two halves of one fact, and nothing checks that a call site pairs them
 * correctly: `useLane(taskKeys.detail(id), () => fetchTasks(filters))` type-checks
 * and is wrong. A spec makes the pair the unit that travels.
 *
 * Options ride along flat, so the freshness a read is defined with is the
 * freshness every call site gets — the drift that a shared key factory cannot
 * prevent, since options live at the call site and the key does not.
 *
 * The type parameters are the read's, unchanged: `T` is what the loader
 * resolves to and `C` is what it sees in `current`. Fixing them at definition
 * time is what makes the *writes* type-checked too — `lane.set(spec, value)` and
 * `lane.update(spec, updater)` know the read's type, where a bare key cannot.
 */
export type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneLoader<T, C>;
};

/**
 * A {@link LaneReadSpec} whose loader may be absent — the colocated form of a
 * gated read. An absent loader means the same thing it means everywhere in Lane:
 * nothing is fetched, subscribed, or stored, and `useLane` hands back a
 * {@link LaneGatedResult} whose `promise` is `undefined`.
 *
 * `T` is still inferred from the loader when it is a conditional
 * (`enabled ? load : undefined`); annotate the spec (`laneRead<Task>({ … })`)
 * when the loader can be nothing else.
 */
export type LaneGatedReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneLoader<T, C> | undefined;
};

/**
 * What an exact-key operation addresses: a key, or anything carrying one — so a
 * spec is accepted wherever its key would be, and a read defined once is
 * invalidated, published to, or removed by that same definition.
 *
 * Scoped operations (`invalidateAll`, `updateAll`, `removeAll`) deliberately do
 * *not* take a spec. A spec describes one read; a scope selects a family of
 * existing entries, which is a different question and still answered by a prefix
 * key or a predicate.
 */
export type LaneTarget = LaneKey | { key: LaneKey };

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
  prefetch<T, C = T>(
    key: LaneKey,
    loader: LaneLoader<T, C>,
    options?: LanePrefetchOptions,
  ): Promise<LaneRead<T>>;
  /**
   * Warm a read from its own definition. Only the fetch-shaping options are
   * taken from the spec (`retry` / `retryDelay`) — `staleTime` / `whenStale`
   * stay the eventual reader's call, exactly as with the key form.
   */
  prefetch<T, C = T>(spec: LaneReadSpec<T, C>): Promise<LaneRead<T>>;
  invalidate(target: LaneTarget, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<LaneRead<T>>;
  /**
   * Publishing through a spec is type-checked: the value must be what that read
   * loads. A bare key cannot check anything — it carries no type.
   */
  set<T, C = T>(
    spec: LaneGatedReadSpec<T, C>,
    valueOrPromise: LaneValue<T>,
  ): Promise<LaneRead<T>>;
  update<T>(
    key: LaneKey,
    updater: LaneUpdater<T>,
  ): Promise<LaneRead<T>> | undefined;
  /** Type-checked like `set`: the updater's `current` is the read's own type. */
  update<T, C = T>(
    spec: LaneGatedReadSpec<T, C>,
    updater: LaneUpdater<T>,
  ): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(target: LaneTarget): void;
  removeAll(scope: LaneScope): void;
  /**
   * Stop the key's in-flight read. Unlike every other operation here it does not
   * converge the key: nothing is notified, so subscribed readers keep the
   * promise they hold rather than starting again.
   *
   * **Only cancel a read you started and can still account for.** Two conditions,
   * both about the call site rather than about the cache:
   *
   * 1. *You issued this read* — your own `invalidate`, a load you are explicitly
   *    offering the user a way to stop, a key whose parameters are spent.
   * 2. *Nothing else reads this key* — cancelling is addressed by key, so on a
   *    shared key one call stops your refresh and someone else's first load.
   *
   * A read left behind by a superseded transition — switching tabs, retyping a
   * search — fails the first. Nobody issued it: state changed, React chose to
   * render, and the read followed. Cancelling it saves a request the caller never
   * asked for and leaves the key holding a rejection instead of nothing.
   *
   * Where the key lands is decided by what it already had. With a last fulfilled
   * value it reverts to it — readers keep showing the data they had, with no
   * `refreshError`, since the caller asked for the stop. With nothing to revert
   * to the read settles rejected, the only end a transition holding no data can
   * reach, and recovers like any other failed first load: the rejection is reused
   * until the key is invalidated, removed, collected, or read with
   * `whenStale: "refetch"`.
   *
   * A settled read is not in progress, so cancelling one does nothing; use
   * `invalidate` or `remove` to discard a value.
   */
  cancel(target: LaneTarget): void;
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
