export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

/**
 * Where an app declares what its loaders are handed besides the key — a session,
 * a tenant, an API client — by module augmentation:
 *
 * ```ts
 * declare module "use-lane" {
 *   interface LaneRegister {
 *     loaderMeta: WorkspaceCtx;
 *   }
 * }
 * ```
 *
 * This exists to solve one problem: **a read whose loader needs a dependency
 * must still be nameable without one.** Binding the dependency into the read
 * factory (`taskReads(ctx).detail(id)`) makes the key unreachable wherever the
 * context is — a mutation module, a Server Component, a component above the
 * provider — so the codebase grows a second, parallel definition of every key
 * just to address entries. Declaring the dependency here keeps the read a plain
 * object whose arguments are exactly what decides its key, so `.key` costs
 * nothing to reach and there is one definition per read.
 *
 * The dependency travels with the *lane*, not the read: `<LaneProvider
 * loaderMeta={ctx}>` supplies it, and {@link LaneLoaderContext.meta} delivers it.
 * That placement is the whole point — it is what a read does not have to know
 * about. A single read that genuinely belongs to another context can still
 * override it ({@link LaneUseOptions.loaderMeta}); because the lane's value is
 * mandatory, that override is a narrowing rather than the only source, which is
 * what keeps `meta` non-optional in the loader.
 *
 * It also means the value is **not part of any key**: two reads of one key under
 * different `loaderMeta` name the same entry, and whichever loaded first wins.
 * Scope what the dependency owns into the key, or drop those keys when it
 * changes (`lane.removeAll(["tasks"])` on a team switch).
 *
 * The mechanism is react-query's `Register`, and so is the asymmetry in naming:
 * `loaderMeta` is what you *declare and supply*, `meta` is what the loader
 * *receives*, exactly as `queryMeta` is declared and `context.meta` received.
 *
 * An app that declares nothing is unaffected: `meta` is `undefined`, and the
 * provider prop and `prefetch` argument stay absent.
 */
export interface LaneRegister {}

/**
 * What {@link LaneRegister} declares, or `undefined` when it declares nothing.
 * Non-optional once declared — a loader that reads `meta` needs no `!`, because
 * the provider cannot omit it.
 */
export type LaneLoaderMeta = LaneRegister extends { loaderMeta: infer M }
  ? M
  : undefined;

/**
 * The `loaderMeta` prop, required exactly when {@link LaneRegister} declares one.
 * Declaring the dependency is what makes forgetting to supply it a type error —
 * at the provider, the one place it is supplied, rather than at every read.
 */
export type LaneLoaderMetaProp = LaneRegister extends { loaderMeta: infer M }
  ? { loaderMeta: M }
  : { loaderMeta?: undefined };

/**
 * The same requirement as a trailing argument, for the read that happens outside
 * React and so cannot reach the provider: `lane.prefetch(read, { loaderMeta })`.
 * A rest tuple rather than a parameter, so an app that declares nothing keeps
 * calling `lane.prefetch(read)` with one argument.
 */
export type LaneLoaderMetaArgs = LaneRegister extends { loaderMeta: infer M }
  ? [options: { loaderMeta: M }]
  : [options?: { loaderMeta?: undefined }];

export type LaneLoaderContext<C = unknown> = {
  key: LaneKey;
  signal: AbortSignal;
  /**
   * What the lane was given as `loaderMeta` — the dependency a loader needs that
   * is not part of its key. See {@link LaneRegister} for how it is declared and
   * why it lives on the lane rather than on the read.
   *
   * Snapshotted when the read is created, like `current`, so every retry of that
   * read sees the value the read started with.
   */
  meta: LaneLoaderMeta;
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
   * so an inline `loader: ({ signal }) => fetchTask(id, signal)` — the form the
   * docs recommend everywhere — would infer `LaneRead<unknown>` instead of
   * `LaneRead<Task>`. (`NoInfer` does not change that.) Keeping the loaded type
   * to the return position and `current` on its own parameter preserves
   * inference, and annotating the read types `current` with it:
   *
   * ```ts
   * useLane<Feed>({ key: ["feed"], loader: async ({ current }) => … });
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

declare const laneExternalTag: unique symbol;

/**
 * A loader the **client** owns: it fetches, so a read built on it is the client's
 * to refresh, publish to, and discard.
 *
 * The optional tag is the whole of it. `external` declares the same tag as
 * `true`, so it is not assignable here — which is what makes a read spec's
 * `loader` slot discriminate between the two ownerships instead of merely
 * accepting both functions. Every plain loader is missing the property and so
 * satisfies it, at no cost to inference or to what a loader may be.
 *
 * It is deliberately *not* on {@link LaneLoader} itself: `external` has to stay a
 * genuine loader everywhere one runs (`readOrCreate` takes it unbranched), and
 * only the places that decide ownership — the read specs, and `prefetch` through
 * them — need to tell the two apart.
 */
export type LaneClientLoader<T, C = T> = LaneLoader<T, C> & {
  readonly [laneExternalTag]?: undefined;
};

/**
 * The type of {@link external}: a real loader, branded so the overloads can see
 * it. Its result type is `never` and its `current` is `unknown`, which is what
 * makes it assignable wherever a `LaneLoader<T, C>` runs — a loader that never
 * produces a value fits every read.
 */
export type LaneExternalLoader = LaneLoader<never, unknown> & {
  readonly [laneExternalTag]: true;
};

/**
 * A read whose value arrives from outside: the owner publishes it (an RSC payload
 * through `<LaneHydration>`, a router's loader data), and the client only reads.
 *
 * The shape is the enforcement. There is no `staleTime` / `whenStale` / `retry` /
 * `refetchOn*` / `loaderMeta`, because every one of them is an instruction to a
 * loader this read does not have — so writing one is an excess property at the
 * `laneRead` call, which is where the mistake was made. What the entry holds
 * cannot be inferred from `external` either, so `T` is annotated:
 * `laneRead<Task>({ key, loader: external })`.
 */
export type LaneExternalReadSpec<T> = {
  key: LaneKeyMaybeOf<T>;
  loader: LaneExternalLoader;
};

/**
 * The gated form of {@link LaneExternalReadSpec} — `loader: enabled ? external :
 * undefined`, which gates the read exactly as an absent client loader does.
 */
export type LaneGatedExternalReadSpec<T> = {
  key: LaneKeyMaybeOf<T>;
  loader: LaneExternalLoader | undefined;
};

/**
 * Where an external read's `T` comes from. A client read infers it from its
 * loader's return type; `external` returns nothing, so the only place left is the
 * key: a {@link LaneKeyOf} (what `laneRead` hands back, so a spec passed on to
 * `useLane` stays typed) supplies it, and a plain array leaves it to the explicit
 * annotation the read needs anyway.
 */
type LaneKeyMaybeOf<T> = LaneKey & { readonly [laneDataTag]?: T };

export type LaneRetryDelay = (attempt: number, error: unknown) => number;

declare const laneDataTag: unique symbol;

/**
 * A key that knows what its entry holds: `LaneKey` carrying the loaded type in a
 * phantom property. `laneRead` stamps it from the loader's return type, so the
 * type is written once, at the definition, and travels *with the key* from then
 * on.
 *
 * That is what makes writes checkable. A key is where type information goes to
 * die in a cache API — `["task", id]` is an array of a string and a string, and
 * nothing in it says `Task`, so `lane.set(["task", id], anything)` can only take
 * the caller's word for it. A key that carries its type turns the same call into
 * a checked one:
 *
 * ```ts
 * lane.set(taskLanes.detail(id).key, task); // checked against Task
 * lane.update(taskLanes.detail(id).key, (task) => …); // `task` is Task
 * ```
 *
 * **The key alone is enough**, which is the point of putting the type here
 * rather than on the read: publishing, invalidating, and removing address an
 * entry, and none of them needs a loader. So `.key` is all a mutation path has
 * to import — no fetcher, and none of the context a fetcher would need. Only
 * `prefetch` takes the whole read, because it is the one operation that
 * *performs* one.
 *
 * The tag is an assertion, not a proof: it records what the read that defined
 * the key loads. Nothing verifies that the value under the key came from that
 * read — `set` publishing something else is exactly what the check is for.
 *
 * At runtime a tagged key is the same array as any other; the property exists
 * only in the type.
 */
export type LaneKeyOf<T> = LaneKey & { readonly [laneDataTag]: T };

/**
 * A key with no type attached — the plain array form, which is every key not
 * built by `laneRead`.
 *
 * It exists to keep the two `set` / `update` overloads apart. A tagged key must
 * not fall through to the untyped signature (`T` would be re-inferred from the
 * value, and the mismatch the tag exists to catch would type-check), so the
 * untyped one has to *reject* a tagged key rather than merely accept both.
 */
export type LanePlainKey = LaneKey & { readonly [laneDataTag]?: undefined };

/**
 * A read described in one place: the key, the loader that fills it, and the
 * options it is read with — the only shape a read is ever described in. Write it
 * inline for a one-off, or build it with {@link laneRead} to share one definition
 * across `useLane`, `useLanesAll`, and `lane.prefetch`.
 *
 * Colocation is the point. A key defined in one module and a loader in another
 * are two halves of one fact, and nothing checks that a call site pairs them
 * correctly: a `taskKeys.detail(id)` key next to a `fetchTasks(filters)` loader
 * type-checks and is wrong. `laneRead` gives the pair one place to live.
 *
 * Options ride along flat, so the freshness a read is defined with is the
 * freshness every call site gets — the drift that a shared key factory cannot
 * prevent, since options live at the call site and the key does not.
 *
 * The type parameters are the read's, unchanged: `T` is what the loader resolves
 * to and `C` is what it sees in `current`. Fixing them at definition time is
 * also what lets `laneRead` hand back a {@link LaneKeyOf} — the type reaching
 * the *write* side without the loader having to come along.
 *
 * `key` is a plain `LaneKey` here, whatever it was built from: a literal, another
 * read's tagged key, or `laneKey`. Constraining it to {@link LaneKeyOf}`<T>` would
 * check a typed key against the loader, and was measured at ~65% more type
 * instantiations per read — paid by every call site, to catch a mismatch you have
 * to construct on purpose. Only what `laneRead` *returns* is tagged.
 */
export type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneClientLoader<T, C>;
};

/**
 * A {@link LaneReadSpec} whose loader may be absent — the colocated form of a
 * gated read. An absent loader means the same thing it means everywhere in Lane:
 * nothing is fetched, subscribed, or stored, and `useLane` hands back a
 * {@link LaneGatedResult} whose `promise` is `undefined`.
 *
 * `T` is still inferred from the loader when it is a conditional
 * (`enabled ? load : undefined`); annotate the spec (`laneRead<Task>({ … })`)
 * when the loader can be nothing else. Gating does not affect the key: a gated
 * read still knows what it would load, so its `.key` is tagged too.
 */
export type LaneGatedReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneClientLoader<T, C> | undefined;
};

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

export type Lane = {
  /**
   * Warm a read before any reader mounts. This is the one method that takes a
   * whole read rather than a key, because it is the one that *performs* a read.
   * Only the fetch-shaping options apply (`retry` / `retryDelay`) — `staleTime` /
   * `whenStale` stay the eventual reader's call.
   *
   * It is also the one read that happens outside React, so it is the one place
   * `loaderMeta` is passed by hand rather than taken from the provider — and only
   * when {@link LaneRegister} declares one.
   *
   * An external read is not one of these: {@link LaneReadSpec} carries a
   * {@link LaneClientLoader}, which `external` is branded out of. There is
   * nothing to warm — the owner publishes — so it is rejected here rather than
   * silently starting a wait that only times out.
   */
  prefetch<T, C = T>(
    read: LaneReadSpec<T, C>,
    ...args: LaneLoaderMetaArgs
  ): Promise<LaneRead<T>>;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  /**
   * Publishing to a {@link LaneKeyOf} is checked against what that key holds —
   * `lane.set(taskLanes.detail(id).key, task)`. The type rides on the key, so a
   * mutation path needs the key and nothing else.
   */
  set<T>(key: LaneKeyOf<T>, valueOrPromise: LaneValue<T>): Promise<LaneRead<T>>;
  /** A plain key carries no type, so the value decides it, as it always has. */
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
  cancel(key: LaneKey): void;
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

/**
 * What `useLane` returns for an external read: {@link LaneResult} without
 * `invalidate`. Nothing is missing — an external entry has no loader to
 * re-run, so invalidating it could only empty a key its owner is expected to
 * fill, which is why the runtime throws on one. Removing it from the type is
 * how that becomes a compile error instead of a crash. The publication channel
 * is the owner's; optimistic UI belongs in `useOptimistic` over the read value.
 */
export type LaneExternalResult<T> = Omit<LaneResult<T>, "invalidate">;

/** {@link LaneExternalResult} for a gated external read. */
export type LaneGatedExternalResult<T> = Omit<LaneGatedResult<T>, "invalidate">;

export type LaneWhenStale = "revalidate" | "refetch";

/**
 * A revalidation trigger. `true` refreshes a value once it is stale — which is
 * `staleTime`'s job to define, so the two go together.
 *
 * There is no "refresh regardless of freshness" form. `staleTime: 0` says it
 * without hiding that it also refetches the value a mount just loaded, and
 * `lane.invalidate(key, { onlyIf: "settled" })` covers a refresh an app schedules
 * on its own terms.
 */
export type LaneRefetchOnMount = boolean;

export type LaneRefetchOnFocus = boolean;

export type LaneRefetchOnReconnect = boolean;

export type LaneUseOptions = {
  /**
   * Read this entry with a different `meta` than the lane carries — the per-read
   * override of {@link LaneRegister}'s `loaderMeta`.
   *
   * Optional, and safely so: the lane always has one (the provider cannot omit
   * it), so this narrows a guaranteed value rather than standing in for a missing
   * one. That is the difference from react-query's `meta`, which is the *only*
   * place the value can come from and is therefore always possibly-`undefined`.
   * Here the fallback is mandatory and the override is not, so `meta` stays
   * non-optional inside the loader either way.
   *
   * The type is `LaneRegister`'s, so this costs no type parameter and nothing to
   * annotate. It is **not part of the key** — same as the lane-level value — so
   * two reads of one key with different meta name the same entry and whichever
   * loads first wins. Reach for it when a single read genuinely belongs to
   * another context (an admin impersonating a tenant, a cross-team lookup) and
   * scope that into the key yourself.
   *
   * In a batch (`useLanesAll`) a member's own override wins over the batch's, the
   * way every other read option does.
   */
  loaderMeta?: LaneLoaderMeta;
  /**
   * How long (ms) a fulfilled value counts as fresh. Defaults to `Infinity`:
   * nothing is stale until an app says what stale means.
   *
   * That default is what makes the revalidation triggers safe to leave on their
   * own terms. `staleTime` is the rate limit on the trigger it gates — a value
   * refreshed within it is not refreshed again, however many times focus /
   * reconnect / mount fire — so a `0` default would ship every app the version
   * with no limit. It also stacks badly with the read/trigger split: a read runs
   * during render and its trigger fires from an effect, so under `0` a mount
   * refetches the value that same mount just loaded.
   *
   * The cost of the default is silence: `whenStale: "refetch"` and the `true` form
   * of every trigger do nothing without a `staleTime`. Both warn in development.
   * `staleTime: 0` is how to ask for "always stale" deliberately.
   */
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
