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
   * Snapshotted when the read is created, like `current`: a read already in
   * flight keeps the value the lane carried when it started.
   */
  meta: LaneLoaderMeta;
  /**
   * The entry's last fulfilled value, or `undefined` on a first load.
   *
   * Snapshotted when the read is created, so a publication landing while the
   * read starts cannot change what the loader was handed. It survives
   * invalidation — invalidating clears the cached promise, not the last
   * fulfilled value — which is what lets a loader re-read *as much as it already
   * had* instead of only what its key describes: the accumulated pages of a
   * list, a cursor to resume from, a revision to send as `If-None-Match`.
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
 * The shape is the enforcement. There is no `staleTime` / `whenStale` /
 * `refetchOn*` / `loaderMeta`, because every one of them is an instruction to a
 * loader this read does not have — so writing one is an excess property at the
 * `laneRead` call, which is where the mistake was made. No `fallback` either,
 * for a sharper reason than absence: the only failure this read can have is
 * {@link LaneExternalTimeoutError}, which says nobody published the key. That is
 * a wiring bug, and serving something in its place would hide a missing
 * publisher behind a plausible screen. What the entry holds cannot be inferred
 * from `external` either, so `T` is annotated:
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
  fallback?: LaneFallback<T>;
};

/**
 * What a read serves when its load fails — the policy that decides whether a
 * failure has an answer, and what it is.
 *
 * It runs on **every** failed load of the read that started it, not only the
 * first. Calling it only when there is nothing to serve would make the same
 * failure behave differently depending on whether this entry happened to have
 * succeeded before — history the caller cannot see. Running it always is what
 * lets the policy be read off the definition:
 *
 * ```ts
 * fallback: ({ lastFulfilled }) => lastFulfilled ?? EMPTY   // keep data, else empty
 * fallback: ({ error, lastFulfilled }) =>                   // branch on the failure
 *   isMissing(error) ? EMPTY : (lastFulfilled ?? raise(error))
 * fallback: ({ error }) => { throw error }                  // never serve a stale value
 * ```
 *
 * The default, for a read that declares none, is the first line of that list
 * without the floor: serve `lastFulfilled` if there is one, otherwise reject.
 *
 * **What it returns is served, never stored.** `lastFulfilled` moves only on a
 * genuine success and the entry keeps the freshness it had — so a read that fell
 * back is still as stale as it was and still refreshes on the next trigger. A
 * policy that hands back what it was given serves it under the entry's own
 * revision, since that is what the number already names; anything else is
 * content the entry never held, and carries a revision of its own. That is the whole reason this is a read
 * option rather than a `try`/`catch` in the loader: a loader that returns a
 * substitute has *succeeded* as far as the store can tell, which restamps the
 * fulfillment time and overwrites the last good value with the substitute.
 *
 * **Throwing is how a read declines.** There is no sentinel return, because
 * `undefined` may be a legitimate `T`. Rethrowing the error it was handed is the
 * ordinary way to say "not this one" — the same move a boundary's fallback makes
 * with an error it does not recognise.
 *
 * **Synchronous.** Returning a promise would be a second loader, and retrying a
 * failed request is the fetcher's job, not the store's.
 *
 * Which read's policy runs is the one whose loader produced the failure — the
 * read that started the load, as with `loaderMeta`. Two reads of one key that
 * declare different policies are the same drift a shared key factory invites,
 * and `laneRead` is the answer to it: one definition per key, options included.
 */
export type LaneFallback<T> = (context: {
  /** The rejection the load produced. */
  error: unknown;
  /** The key that failed, for a policy shared across several reads. */
  key: LaneKey;
  /**
   * The entry's last fulfilled value, or `undefined` when no load of this key
   * has ever succeeded.
   *
   * Named for what it is rather than reusing the loader's `current`: that one is
   * typed `C`, deliberately free to be narrower or wider than the result, so a
   * policy handed it could not return it unchanged. This one is `T`, which is
   * what the read has to resolve to.
   *
   * A loader that resolves `undefined` makes this ambiguous — "never succeeded"
   * and "succeeded with `undefined`" arrive the same way. Return a domain empty
   * value instead if the difference matters.
   */
  lastFulfilled: T | undefined;
}) => T;

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
  fallback?: LaneFallback<T>;
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
  /**
   * Which entries in reach actually invalidate.
   *
   * - `"stale"`: fulfilled and older than `staleTime`. What every revalidation
   *   trigger fires as.
   * - `"settled"`: anything not in flight.
   * - `"rejected"`: only entries whose last read failed *with nothing to show* —
   *   exactly the keys whose readers are in an error boundary. Stale-on-error
   *   records the fallback's settlement, so a key still serving data is not one
   *   of these however its last load went, and an in-flight read is excluded as
   *   above. That is what makes `invalidateAll(scope, { onlyIf: "rejected" })`
   *   safe to fire at a whole subtree: it retries what is broken and cannot
   *   disturb what is on screen. The blunt companion to
   *   {@link LaneReadError}'s `key`, for when one boundary is holding several
   *   failed keys and caught only the first.
   */
  onlyIf?: "stale" | "settled" | "rejected";
  staleTime?: number;
  /**
   * Converge through the background transition (surfaces as `isBackgroundPending`)
   * instead of the default explicit one (`isInvalidationPending`). Use it for
   * automatic refreshes — e.g. a self-scheduled poll — so they don't read as a
   * user-driven invalidation.
   */
  background?: boolean;
};

export type Lane = {
  /**
   * Warm a read before any reader mounts. This is the one method that takes a
   * whole read rather than a key, because it is the one that *performs* a read.
   * It takes the read's key, its loader, and its `loaderMeta` — the three things
   * running one needs. Everything else on the read describes what a *reader*
   * does with the value (`staleTime` / `whenStale` / `refetchOn*`), and warming
   * is not the read, so those stay the eventual reader's call.
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
  /**
   * Open the invalidation transition of every reader in a scope — the scoped
   * form of {@link LaneResult.startInvalidationTransition}, and the one to call
   * from inside a mutation for the keys it touches:
   *
   * ```ts
   * startInvalidationTransition(async () => {
   *   await saveTask(patch);   // the helper announces its own reach
   *   invalidate();
   * });
   *
   * // …inside the helper
   * lane.startInvalidationTransition(["insights"]);
   * ```
   *
   * It starts the *readers'* transitions, not the caller's, so it composes the
   * way React's own `startTransition` nests: called inside one, those readers
   * join that scope and stay pending for as long as it runs. Called outside any
   * transition it is close to a no-op — each reader opens an empty transition
   * that commits immediately — and the symptom is the thing you called it for
   * not happening, so it is documented rather than guarded (there is no way to
   * ask React whether a transition is in progress).
   *
   * Nothing is stored and no read is scheduled. A notification that replaced the
   * cache would make readers re-read *now*, against a source the caller has not
   * changed yet. Converging is still the action's job.
   *
   * Throws {@link LaneOwnershipError} on a published key, checked across the
   * whole match first: announcing one promises an invalidation the client cannot
   * make.
   */
  startInvalidationTransition(scope: LaneScope): void;
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
   * `error`, since the caller asked for the stop. With nothing to revert
   * to the read settles rejected, the only end a transition holding no data can
   * reach, and recovers like any other failed first load: the rejection is reused
   * until the key is invalidated, removed, or collected.
   *
   * A settled read is not in progress, so cancelling one does nothing; use
   * `invalidate` or `remove` to discard a value.
   */
  cancel(key: LaneKey): void;
};

/**
 * What a read resolves to. `data` is the value; `error` is present when the load
 * that would have produced it failed and something else is being served in its
 * place — the last fulfilled value, or what the read's
 * {@link LaneReadSpec.fallback} returned.
 *
 * The error travels in the same resolved value as the data it accompanies, so a
 * reader sees both consistently through `use(promise)` — no separate,
 * render-time store read. That is the whole of why it is here and not on
 * `useLane`: a field read live from the store during render could disagree with
 * the data beside it, and this cannot.
 */
export type LaneRead<T> = {
  data: T;
  /**
   * The identity of `data`'s content — a serializable stand-in for the
   * reference equality structural sharing already guarantees: a refetch that
   * came back deep-equal keeps the previous reference *and* the previous
   * revision, and only a genuine content change mints a new one. Equality is
   * the entire contract; the numbers are minted lane-wide, so nothing about
   * order, density, or reuse across entries may be read into them.
   *
   * What it is for is naming content where a reference cannot go — chiefly as
   * key material for a read *derived from* this one, so the derived key changes
   * exactly when this entry's content does:
   *
   * ```ts
   * const source = use(sourcePromise);
   * useLane(prepareRead(source.data.documentId, source.revision));
   * ```
   *
   * For a comparison between two reads you already hold, `revision` adds
   * nothing over `===` on `data` — structural sharing makes the reference
   * comparison exactly as precise.
   *
   * It rides in the resolved value, like `error`, so `data` and `revision` are
   * one settlement and can never tear: a result that fell back keeps serving the
   * old data under the old revision. Session-local — never serialize it into a
   * snapshot or compare it across lanes.
   *
   * **On an external read the identity is one notch weaker: the publication's,
   * not the content's.** An external entry keeps no previous value to compare
   * against (the weak retention forbids it), so "unchanged" is not a fact the
   * client can establish — every publication mints a new revision, including a
   * republish of identical content. Same revision ⇒ same content still holds;
   * what does not is the converse, so a derived key built from an external
   * revision re-derives per publication. When the content has a real version,
   * its owner has it — ship it in the payload and key on that instead.
   */
  revision: number;
  /**
   * The failure of the load that would have produced `data`, when something else
   * is being served in its place. Absent when the latest load succeeded, and
   * absent after a cancel — the caller asked for the stop, so it is not a
   * failure to report.
   *
   * Its presence says `data` did not come from a successful load; it does *not*
   * say the read is broken. The value beside it may be perfectly good, only
   * older than it should be. Treat it as a reason to annotate, not a reason to
   * discard what is on screen.
   *
   * A first load with nothing to serve — no previous value, and no
   * {@link LaneReadSpec.fallback} that returned one — rejects the promise
   * instead, so this field never carries the failure that had no answer.
   */
  error?: unknown;
};

/**
 * Run an action inside this reader's invalidation transition, so
 * {@link LaneResult.isInvalidationPending} is on from the moment it starts
 * rather than from the moment it finishes.
 *
 * ```ts
 * startInvalidationTransition(async () => {
 *   await saveTodo(patch);
 *   invalidate();
 * });
 * ```
 *
 * The plain `await action(); invalidate()` shape leaves every reader showing
 * stale data with no sign anything is happening, because notification is Lane's
 * only channel to a reader and it fires last. This moves the transition to the
 * front: readers keep their current value on screen, report pending, and
 * converge when the action's own invalidation lands — one continuous window
 * instead of two.
 *
 * **Nothing is stored, and the action is not Lane's.** Its value is ignored and
 * its rejection is never caught, so a failed save cannot arrive at a reader as
 * `error` — that field means a *load* of this key failed while something else is
 * being served, which is a different fact about a different thing. Converge inside the
 * action, with whatever `invalidate` / `set` / `update` calls the change actually
 * needs, and handle the failure where you would have anyway.
 *
 * It opens **this reader's** transition and nothing else. Keys a mutation
 * touches beyond this one join by calling {@link Lane.startInvalidationTransition}
 * *inside* the action — which is where that knowledge belongs, because a
 * mutation helper knows its own reach and its caller does not.
 */
export type LaneStartInvalidationTransition = (action: () => unknown) => void;

/**
 * The reader's own `invalidate` — the key-addressed `lane.invalidate` bound to
 * this read, which is what lets it return something the instance method cannot:
 * **the next read**. A key alone does not know its loader, so `lane.invalidate`
 * can only clear and notify; the hook holds the whole read, so after
 * invalidating it starts (or joins) the re-read and hands back its promise —
 * the same promise every subscribed reader of the key adopts, by the store's
 * own dedupe.
 *
 * ```ts
 * startInvalidationTransition(async () => {
 *   const next = await invalidate();
 *
 *   if (next.data !== current.data) {
 *     // the source really changed — converge what derives from it
 *     lane.invalidateAll(["analysis", "query", id]);
 *   }
 * });
 * ```
 *
 * The resolved value keeps every existing contract, because it *is* the read's:
 * a failed load with something to fall back to resolves `{ data, error }` rather
 * than rejecting, a failure with nothing to serve rejects, and
 * structural sharing makes the `!==` above a precise change check (`revision`
 * says the same thing as a number). Resolving means the data settled — not that
 * React committed it; readers converge through their transitions as they always
 * have. An invalidation skipped by `onlyIf` returns the current cached promise,
 * so awaiting it is always awaiting "the key's value after this call".
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
 * The shape `useLane` returns when the loader may be absent. Passing
 * `loader: undefined` gates the read off, so `promise` is `undefined` while
 * disabled (nothing is fetched, subscribed, or stored under the key). Unwrap it
 * conditionally — `result.promise ? use(result.promise) : fallback` — which is
 * allowed because `use` may be called inside conditionals.
 *
 * `invalidate` widens the same way `promise` does: while disabled there is no
 * loader to re-read with, so it still clears the entry but has no next read to
 * return.
 */
export type LaneGatedResult<T> = Omit<LaneResult<T>, "promise" | "invalidate"> & {
  promise: Promise<LaneRead<T>> | undefined;
  invalidate: (
    options?: LaneInvalidateOptions,
  ) => Promise<LaneRead<T>> | undefined;
};

/**
 * What `useLane` returns for an external read: {@link LaneResult} without
 * `invalidate` or `startInvalidationTransition`. Nothing is missing — an
 * external entry has no loader to re-run, so invalidating it could only empty a
 * key its owner is expected to fill, which is why the runtime throws on one.
 * Removing it from the type is how that becomes a compile error instead of a
 * crash. Announcing one goes with it: the announcement's promise is that an
 * invalidation is coming, and this is the reader that cannot make it — the
 * owner decides when the key changes, and its own transition (a Server Action,
 * a router revalidation) is already the pending signal. The publication channel
 * is the owner's; optimistic UI belongs in `useOptimistic` over the read value.
 */
export type LaneExternalResult<T> = Omit<
  LaneResult<T>,
  "invalidate" | "startInvalidationTransition"
>;

/** {@link LaneExternalResult} for a gated external read. */
export type LaneGatedExternalResult<T> = Omit<
  LaneGatedResult<T>,
  "invalidate" | "startInvalidationTransition"
>;

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
   * How long this read's value is worth keeping once nothing is holding it —
   * this read's override of the lane's {@link LaneOptions.gcTime}, and the way
   * to say "do not serve this again after I leave".
   *
   * ```
   * gcTime: 0        // a remount always loads fresh
   * gcTime: 5_000    // come straight back and reuse it; linger and reload
   * gcTime: Infinity // keep it
   * ```
   *
   * It reads as a memory setting and is a freshness one too, because for an
   * *idle* entry those are the same question: a value nobody holds is kept for
   * exactly one reason — the reader who might come back — so "how long is it
   * worth keeping" and "how long is it worth serving" have one answer. Which is
   * why the load a remount starts after the deadline suspends: the entry is
   * simply gone, so the wait joins whatever transition the remount is part of,
   * instead of committing a stale value and refreshing it afterwards.
   *
   * Freshness *while a reader is mounted* is the other mechanism — `staleTime`
   * with `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect`, which
   * refresh what is on screen without taking it away.
   *
   * The deadline is set when the entry goes idle, from the `gcTime` of whoever
   * held it last (at zero subscribers, the departing reader is the only one
   * there is to ask). Eviction is never synchronous, so an unsubscribe and a
   * resubscribe within one task — StrictMode's double invoke, a re-suspension —
   * collect nothing.
   */
  gcTime?: number;
  /**
   * How long this read's value is kept for a reader who has *not arrived yet* —
   * measured from the moment it settles, and spent only while nothing holds the
   * entry.
   *
   * Two situations, and they are the same one: a value warmed by
   * {@link Lane.prefetch} that nobody has read, and an entry created by a render
   * that suspended and unmounted before it could commit. Both are a load done
   * for a reader who may still be coming, and this says how long "still coming"
   * stays plausible.
   *
   * Deliberately not {@link LaneUseOptions.gcTime}. That answers "somebody had
   * this and left — how long is it worth keeping for their return", which shares
   * nothing with this but a unit: one is a bet on an arrival, the other a memory
   * policy about a departure, and there is no reason for either to name the
   * other's number.
   *
   * The clock never runs while the read is in flight. An entry nobody holds is
   * not evidence that nobody is coming, and a load still running is evidence
   * that somebody might be — collecting one would abort a read a suspended
   * render is still waiting on.
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
   * How long (ms) an inactive entry (no subscribers) is retained before it is
   * garbage-collected — the default for reads that do not set their own
   * {@link LaneUseOptions.gcTime}. Idle-time based, and unrelated to
   * `staleTime`: freshness is about refreshing what a reader is showing, this is
   * about what is left for the next one. Default 5 minutes; `Infinity` opts out.
   *
   * The instance value is a default rather than a floor or a ceiling. Retention
   * used to be instance-wide on the argument that it is a memory policy; it is
   * that and also a *reuse* policy, and how long a value is worth serving again
   * belongs to the data rather than to the app.
   *
   * Collection is coalesced into one timer per lane, armed for the nearest
   * deadline. It is never synchronous, however short the `gcTime`: an
   * unsubscribe and a resubscribe within one task — StrictMode's double invoke,
   * a re-suspension — collect nothing.
   */
  gcTime?: number;
  /**
   * How long a settled entry *nobody has ever held* waits for its first reader —
   * the default for reads that do not set their own
   * {@link LaneUseOptions.warmTime}. Default 1 minute.
   *
   * Shorter than `gcTime`'s default and unrelated to it: this is spent on an
   * arrival that has not happened (a prefetch nobody read yet, a render that
   * suspended and unmounted), that one on a reader who was there and may return.
   * Both situations here are short — the seconds between a hover and the click,
   * a navigation that changed its mind — so a minute is generous for either, and
   * a prefetch placed further ahead of its reader than that is a bet the read
   * should state itself.
   */
  warmTime?: number;
};
