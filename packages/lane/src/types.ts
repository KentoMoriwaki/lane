export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

/**
 * Module-augmentation point. Declaring `loaderMeta` types the dependency every
 * loader receives as {@link LaneLoaderContext.meta}, supplied by
 * `<LaneProvider loaderMeta={ctx}>` (or `lane.prefetch(read, { loaderMeta })`):
 *
 * ```ts
 * declare module "use-lane" {
 *   interface LaneRegister {
 *     loaderMeta: WorkspaceCtx;
 *   }
 * }
 * ```
 *
 * The value is **not part of any key**: two reads of one key under different
 * `loaderMeta` name the same entry. If nothing is declared, `meta` is
 * `undefined` and the provider prop and `prefetch` argument stay absent.
 */
export interface LaneRegister {}

/**
 * What {@link LaneRegister} declares, or `undefined` when it declares nothing.
 * Non-optional once declared: the provider cannot omit it, so a loader that
 * reads `meta` needs no `!`.
 */
export type LaneLoaderMeta = LaneRegister extends { loaderMeta: infer M }
  ? M
  : undefined;

/**
 * The provider's `loaderMeta` prop — required exactly when
 * {@link LaneRegister} declares one, so forgetting to supply it is a type
 * error at the provider.
 */
export type LaneLoaderMetaProp = LaneRegister extends { loaderMeta: infer M }
  ? { loaderMeta: M }
  : { loaderMeta?: undefined };

/**
 * The same requirement as `lane.prefetch`'s trailing options argument. A rest
 * tuple, so an app that declares nothing keeps calling `lane.prefetch(read)`.
 */
export type LaneLoaderMetaArgs = LaneRegister extends { loaderMeta: infer M }
  ? [options: { loaderMeta: M }]
  : [options?: { loaderMeta?: undefined }];

export type LaneLoaderContext<C = unknown> = {
  key: LaneKey;
  signal: AbortSignal;
  /**
   * The lane's `loaderMeta` (or the read's override), snapshotted when the
   * read starts. See {@link LaneRegister}.
   */
  meta: LaneLoaderMeta;
  /**
   * The entry's last fulfilled value, or `undefined` on a first load and once
   * the entry is gone (removed, collected, or invalidated while unheld).
   * Snapshotted when the read starts. It survives invalidation — that clears
   * the cached promise, not the last fulfilled value — so a loader can resume
   * from what it already had (accumulated pages, a cursor).
   *
   * Typed by the read's second type parameter (default: the loaded type); an
   * annotation is required to use it — `useLane<Feed>({ … })` makes `current`
   * `Feed | undefined`. Without one, reading it is a type error, not `any`.
   */
  current: C | undefined;
};

/**
 * `T` is what the loader resolves to; `C` is what it sees in `current`,
 * defaulting to `T`. Give `C` explicitly only when `current` is deliberately
 * narrower or wider than the result.
 */
export type LaneLoader<T, C = T> = (
  context: LaneLoaderContext<C>,
) => Promise<T>;

declare const laneExternalTag: unique symbol;

/**
 * A loader the **client** owns — every plain {@link LaneLoader} satisfies it.
 * The phantom tag only excludes {@link external} (which declares the tag as
 * `true`), so a read spec's `loader` slot discriminates between the two
 * ownerships.
 */
export type LaneClientLoader<T, C = T> = LaneLoader<T, C> & {
  readonly [laneExternalTag]?: undefined;
};

/**
 * The type of {@link external}: a real loader, branded so overloads can
 * recognise it. It resolves `never`, so it is assignable wherever a
 * `LaneLoader<T, C>` runs.
 */
export type LaneExternalLoader = LaneLoader<never, unknown> & {
  readonly [laneExternalTag]: true;
};

/**
 * A read whose loader its owner holds: the value arrives by publication (an RSC
 * payload through `<LaneHydration>`, a router's loader data), and a re-read asks
 * the owner to publish again through the lane's {@link LaneOptions.refresh}.
 * Everything else is an ordinary read — `invalidate`, `set` and `update` all
 * work on it.
 *
 * No freshness options (`staleTime`, `refetchOn*`) and no `fallback`: freshness
 * is the owner's, there is no client loader to instruct, and the only failure
 * of the read itself is {@link LaneExternalTimeoutError} (the ask went
 * unanswered). `T` cannot be inferred from `external`, so annotate:
 * `laneRead<Task>({ key, loader: external })`.
 */
export type LaneExternalReadSpec<T> = {
  key: LaneKeyMaybeOf<T>;
  loader: LaneExternalLoader;
};

/**
 * The gated form of {@link LaneExternalReadSpec} —
 * `loader: enabled ? external : undefined` gates the read off exactly as an
 * absent client loader does.
 */
export type LaneGatedExternalReadSpec<T> = {
  key: LaneKeyMaybeOf<T>;
  loader: LaneExternalLoader | undefined;
};

/**
 * Where an external read's `T` comes from: a {@link LaneKeyOf} supplies it,
 * and a plain array leaves it to the explicit annotation.
 */
type LaneKeyMaybeOf<T> = LaneKey & { readonly [laneDataTag]?: T };

declare const laneDataTag: unique symbol;

/**
 * A key that carries its entry's loaded type in a phantom property. `laneRead`
 * stamps it from the loader's return type, making writes checkable —
 * `lane.set(taskLanes.detail(id).key, task)` is checked against `Task`, with
 * only the key imported. At runtime it is a plain array; the tag is a
 * type-level assertion, not a runtime guarantee.
 */
export type LaneKeyOf<T> = LaneKey & { readonly [laneDataTag]: T };

/**
 * A key with no type attached — every key not built by `laneRead`. Exists so
 * the untyped `set` / `update` overloads reject a tagged key instead of
 * re-inferring `T` from the value.
 */
export type LanePlainKey = LaneKey & { readonly [laneDataTag]?: undefined };

/**
 * A read described in one place: the key, the loader that fills it, and the
 * options it is read with. Write it inline for a one-off, or build it with
 * {@link laneRead} to share one definition across `useLane`, `useLanesAll`,
 * and `lane.prefetch`. `T` is what the loader resolves to; `C` is what it sees
 * in `current`. `key` is a plain `LaneKey` whatever it was built from; only
 * what `laneRead` *returns* is tagged.
 */
export type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneClientLoader<T, C>;
  fallback?: LaneFallback<T>;
};

/**
 * What a read serves when its load fails. Runs on **every** failed load of the
 * read that started it. Default, when none is declared: serve `lastFulfilled`
 * if there is one, otherwise reject.
 *
 * What it returns is served, never stored: `lastFulfilled` moves only on a
 * genuine success and the entry keeps the freshness it had, so a fallen-back
 * read is still as stale as it was and still refreshes on the next trigger.
 * Throwing declines (rethrow `error` to say "not this one") and the read
 * rejects. Must be synchronous — retrying is the fetcher's job.
 */
export type LaneFallback<T> = (context: {
  /** The rejection the load produced. */
  error: unknown;
  /** The key that failed, for a policy shared across several reads. */
  key: LaneKey;
  /**
   * The entry's last fulfilled value (`T`), or `undefined` when no load of
   * this key has ever succeeded. A loader that resolves `undefined` makes the
   * two cases indistinguishable — return a domain empty value instead if the
   * difference matters.
   */
  lastFulfilled: T | undefined;
}) => T;

/**
 * A {@link LaneReadSpec} whose loader may be absent — the colocated form of a
 * gated read. An absent loader means nothing is fetched, subscribed, or
 * stored, and `useLane` returns a {@link LaneGatedResult} whose `promise` is
 * `undefined`. `T` is still inferred from a conditional loader
 * (`enabled ? load : undefined`); annotate (`laneRead<Task>({ … })`) when the
 * loader can be nothing else. The `.key` is tagged either way.
 */
export type LaneGatedReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneClientLoader<T, C> | undefined;
  fallback?: LaneFallback<T>;
};

/** What scoped operations match: a key prefix, or a predicate over entries. */
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
  /**
   * Which entries in reach actually invalidate. Absent: all of them.
   *
   * - `"stale"`: fulfilled and older than `staleTime` — what every
   *   revalidation trigger fires as.
   * - `"settled"`: anything not in flight.
   * - `"rejected"`: only entries whose last read failed *with nothing to
   *   show* — exactly the keys whose readers are in an error boundary. A read
   *   that fell back records a fulfilled settlement, so a key still serving
   *   data is untouched; safe to fire at a whole subtree to retry what is
   *   broken.
   */
  onlyIf?: "stale" | "settled" | "rejected";
  /** Staleness threshold (ms) for `onlyIf: "stale"`; the read's by default. */
  staleTime?: number;
  /**
   * Converge through the background transition (`isBackgroundPending`)
   * instead of the default explicit one (`isInvalidationPending`) — for
   * automatic refreshes such as a self-scheduled poll.
   */
  background?: boolean;
};

export type Lane = {
  /**
   * Warm a read before any reader mounts: start the load — deduping onto an
   * in-flight or settled cache — and return its promise. Uses the read's key,
   * loader, `loaderMeta`, `warmTime`, and `fallback`; reader-side options
   * (`staleTime`, `gcTime`, `refetchOn*`) do not apply. This is the one read
   * outside React, so `loaderMeta` is passed by hand — and only when
   * {@link LaneRegister} declares one. Throws {@link LaneOwnershipError} for
   * an external read: warming one would mean asking its owner to render the
   * whole route for a key nothing is reading yet.
   */
  prefetch<T, C = T>(
    read: LaneReadSpec<T, C>,
    ...args: LaneLoaderMetaArgs
  ): Promise<LaneRead<T>>;
  /**
   * Open the invalidation transition of every subscribed reader in a scope —
   * the scoped form of {@link LaneResult.startInvalidationTransition}, for a
   * mutation helper to announce the keys it touches. Nothing is stored and no
   * read is scheduled: converging is still the action's job. Must be called
   * inside a transition; outside one it is effectively a no-op.
   */
  startInvalidationTransition(scope: LaneScope): void;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  /**
   * Publishing to a {@link LaneKeyOf} is checked against what that key holds —
   * `lane.set(taskLanes.detail(id).key, task)`. The type rides on the key, so
   * a mutation path needs the key and nothing else.
   */
  set<T>(key: LaneKeyOf<T>, valueOrPromise: LaneValue<T>): Promise<LaneRead<T>>;
  /** A plain key carries no type, so the value decides it. */
  set<T>(key: LanePlainKey, valueOrPromise: LaneValue<T>): Promise<LaneRead<T>>;
  /** Checked like `set`: the updater's `current` is what the key holds. */
  update<T>(
    key: LaneKeyOf<T>,
    updater: LaneUpdater<T>,
  ): Promise<LaneRead<T>> | undefined;
  update<T>(
    key: LanePlainKey,
    updater: LaneUpdater<T>,
  ): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
  /**
   * Stop the key's in-flight read without notifying subscribers — readers keep
   * the promise they hold. Only cancel a read you started yourself, on a key
   * nothing else reads (cancellation is addressed by key). With a last
   * fulfilled value the read reverts to it, with no `error`; with nothing to
   * revert to it settles rejected, and the rejection is reused like any failed
   * first load until the key is invalidated, removed, or collected. A settled
   * read is unaffected; use `invalidate` or `remove` to discard a value.
   */
  cancel(key: LaneKey): void;
};

/**
 * What a read resolves to. `error` is present when the load that would have
 * produced `data` failed and something else is served in its place — the last
 * fulfilled value, or what the read's {@link LaneReadSpec.fallback} returned.
 * It rides in the resolved value so `data` and `error` are one settlement,
 * seen consistently through `use(promise)`.
 */
export type LaneRead<T> = {
  data: T;
  /**
   * The identity of `data`'s content, minted from a lane-wide counter. A
   * refetch that came back deep-equal keeps the previous reference *and*
   * revision; only a genuine content change mints a new one. Equality is the
   * entire contract — read nothing into order or density. Use it as key
   * material for a read derived from this one; for two reads you already hold,
   * `===` on `data` is just as precise. Session-local: never serialize it or
   * compare it across lanes.
   *
   * On an external read it is the *publication's* identity, not the content's:
   * every publication mints a new revision, even a republish of identical
   * content. Same revision ⇒ same content still holds; the converse does not.
   */
  revision: number;
  /**
   * The failure of the load that would have produced `data`, when something
   * else is served in its place. Absent when the latest load succeeded, and
   * absent after a `cancel`. A failure with nothing to serve rejects the
   * promise instead, so this never carries a failure that had no answer.
   */
  error?: unknown;
};

/**
 * Run an action inside this reader's invalidation transition, so
 * {@link LaneResult.isInvalidationPending} is on from the moment it starts:
 * `startInvalidationTransition(async () => { await saveTodo(patch); invalidate(); })`.
 *
 * Nothing is stored: the action's value is ignored and its rejection is not
 * caught — converge inside the action with `invalidate` / `set` / `update`,
 * and handle failures yourself. It opens **this reader's** transition only;
 * other keys join via {@link Lane.startInvalidationTransition} inside the
 * action.
 */
export type LaneStartInvalidationTransition = (action: () => unknown) => void;

/**
 * The reader's own `invalidate`: `lane.invalidate` bound to this read, which
 * also returns **the next read** — the promise every subscribed reader of the
 * key adopts. The resolved value keeps the read's contracts: a failed load
 * with something to fall back to resolves `{ data, error }`, a failure with
 * nothing to serve rejects. An invalidation skipped by `onlyIf` returns the
 * current cached promise, so awaiting it is always awaiting "the key's value
 * after this call".
 */
export type LaneInvalidate<T> = (
  options?: LaneInvalidateOptions,
) => Promise<LaneRead<T>>;

export type LaneResult<T> = {
  promise: Promise<LaneRead<T>>;
  isBackgroundPending: boolean;
  isInvalidationPending: boolean;
  invalidate: LaneInvalidate<T>;
  startInvalidationTransition: LaneStartInvalidationTransition;
};

/**
 * The shape `useLane` returns when the loader may be absent. While disabled
 * (`loader: undefined`) `promise` is `undefined` — unwrap conditionally:
 * `result.promise ? use(result.promise) : fallback`. `invalidate` widens the
 * same way: while disabled it still clears the entry but has no next read to
 * return.
 */
export type LaneGatedResult<T> = Omit<LaneResult<T>, "promise" | "invalidate"> & {
  promise: Promise<LaneRead<T>> | undefined;
  invalidate: (
    options?: LaneInvalidateOptions,
  ) => Promise<LaneRead<T>> | undefined;
};

/**
 * A revalidation trigger, off by default. `true` refreshes the value once it
 * is stale — which `staleTime` defines, so the two go together. There is no
 * "refresh regardless of freshness" form: use `staleTime: 0`, or
 * `lane.invalidate(key, { onlyIf: "settled" })` for a refresh the app
 * schedules itself.
 */
export type LaneRefetchOnMount = boolean;

export type LaneRefetchOnFocus = boolean;

export type LaneRefetchOnReconnect = boolean;

export type LaneUseOptions = {
  /**
   * Read this entry with a different `meta` than the lane carries — the
   * per-read override of {@link LaneRegister}'s `loaderMeta`. Optional: the
   * lane always has one, so this narrows a guaranteed value. **Not part of the
   * key** — two reads of one key with different meta name the same entry. In a
   * batch (`useLanesAll`) a member's own override wins over the batch's.
   */
  loaderMeta?: LaneLoaderMeta;
  /**
   * How long (ms) a fulfilled value counts as fresh. Default `Infinity`:
   * nothing is stale until the app says what stale means, so the `refetchOn*`
   * triggers do nothing without a `staleTime` (they warn in development). It
   * is also the rate limit on those triggers — a value refreshed within it is
   * not refreshed again, however often they fire. `staleTime: 0` means
   * "always stale", deliberately.
   */
  staleTime?: number;
  /**
   * How long (ms) this read's value is kept once nothing is holding it — the
   * per-read override of {@link LaneOptions.gcTime}. `0` makes a remount load
   * fresh; `Infinity` keeps it. The deadline is set when the entry goes idle,
   * from the departing reader's `gcTime`; eviction is never synchronous, so an
   * unsubscribe and resubscribe within one task (StrictMode, a re-suspension)
   * collect nothing. Freshness *while mounted* is `staleTime` / `refetchOn*`'s
   * job instead.
   */
  gcTime?: number;
  /**
   * How long (ms) a settled value nobody has held yet is kept for its first
   * reader — a prefetch nobody read, or a render that suspended and unmounted.
   * Measured from settlement, spent only while nothing holds the entry, never
   * while the read is in flight. Per-read override of
   * {@link LaneOptions.warmTime}.
   */
  warmTime?: number;
  refetchOnFocus?: LaneRefetchOnFocus;
  refetchOnMount?: LaneRefetchOnMount;
  refetchOnReconnect?: LaneRefetchOnReconnect;
};

/**
 * Construction-time options for a `Lane` instance.
 */
export type LaneOptions = {
  /**
   * How long (ms) an idle entry (no subscribers) is retained before it is
   * garbage-collected — the default for reads that do not set their own
   * {@link LaneUseOptions.gcTime}. Default 5 minutes; `Infinity` opts out.
   * Collection is coalesced into one timer per lane and is never synchronous.
   */
  gcTime?: number;
  /**
   * How long (ms) a settled entry nobody has ever held waits for its first
   * reader — the default for reads that do not set their own
   * {@link LaneUseOptions.warmTime}. Default 1 minute.
   */
  warmTime?: number;
  /**
   * The owner-ask: how Lane says "render again" when a reader needs an external
   * key whose value the owner has not supplied. In Next's App Router
   * `() => router.refresh()`; in React Router's data mode
   * `() => revalidator.revalidate()`.
   *
   * Called out of render, at most once per tick per lane however many keys and
   * readers asked. Nothing is tracked beyond that tick — it returns `void`, so
   * there is no completion to wait for, and the answer arrives as a publication
   * like any other. Asked only for a key an owner has already filled once: on a
   * first mount the payload is already on its way. Without one, a reader of a
   * key nobody publishes again waits out
   * {@link LaneExternalTimeoutError}'s timeout.
   *
   * Also settable per provider — `<LaneProvider refresh={…}>` installs it on
   * the lane it holds or creates.
   */
  refresh?: () => void;
};
