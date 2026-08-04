# Changelog

All notable changes to `use-lane` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`startInvalidationTransition`, returned by `useLane` / `useInfiniteLane`.**
  Runs an action inside the reader's invalidation transition, so
  `isInvalidationPending` is on from when the action *starts* rather than from
  when it finishes. `await action(); invalidate()` can only tell readers at the
  end — notification is Lane's only channel to them and it fires last — which
  leaves the whole request showing stale data with no sign anything is happening.

  ```ts
  startInvalidationTransition(async () => {
    await saveTask(patch);
    invalidate();
  });
  ```

  Other keys a mutation touches join with the scoped form,
  **`lane.startInvalidationTransition(scope)`**, called from inside the action —
  where the knowledge is, since a mutation helper knows its own reach and its
  caller does not. Their readers open their transitions in the same synchronous
  fan-out `invalidate` already uses, so every reader in the window goes pending in
  one tick and they all converge on one commit. What is announced is not what is
  converged: what converges is what changed, what is announced is what should look
  busy, and a `background: true` refresh is asking not to be one of them.

  Lane never touches the action: its value is ignored and its rejection is never
  caught, so a failed save cannot arrive at a reader as `refreshError`. Nothing
  is stored when the window opens either — an announcement schedules no read,
  because the source has not changed yet. External reads do not get it, for the
  reason they do not get `invalidate`.

  It costs **+120 B** on the typical `LaneProvider` + `useLane` pair on its own,
  and removing the gate `after` needed gives 90 B of that back, so the net across
  both changes is **+30 B** (3.84 → 3.87 kB, against an unchanged 3.9 kB budget).
  The store is back where it started at 2.47 kB, and no `size-limit` budget
  moves.

### Removed

- **Breaking: `invalidate`'s `after` option is gone**, replaced by
  `startInvalidationTransition`. It answered the same question — how to mark
  readers pending while a mutation runs — by taking the action's promise as a
  clock and holding the re-reads behind it. That worked, and cost more than it
  looked: Lane had to observe a promise that was never its own (swallowing the
  rejection, so a failed action still converged and its failure never surfaced),
  and the early invalidation it performed had to be undone by a gate, since
  re-reading before the action lands fetches the pre-mutation source. Running the
  action inside a transition needs none of that — React's entanglement holds the
  window open, so the gate, the swallowed rejection, and the deferral path for a
  key nobody was reading all leave with the option.

  ```ts
  // Before
  const saved = saveTodo(patch);
  lane.invalidateAll(["todos"], { after: saved });
  await saved;

  // After
  startInvalidationTransition(async () => {
    await saveTodo(patch);
    lane.invalidateAll(["todos"]);
  });
  ```

  One behavior does not carry over, and it was the option's own compromise: a
  rejected action still converged, because `after` chose *when* to re-read rather
  than whether to. Now the converge calls are yours, inside the action, so a
  failure that should not converge simply does not reach them — and one that
  should still can, from a `catch`.

### Changed

- **Breaking: `isTransitionPending` is now `isInvalidationPending`.** Both pending
  flags a reader returns come from `useTransition()`, so "transition" named what
  they share rather than what tells them apart — the field said nothing. What
  separates them is the cause: an explicit invalidation against an automatic
  revalidation, and only the second half already had the name it needed
  (`isBackgroundPending`). `set` and `update` set it too, which is not a stretch of
  the word — both are [prefilled
  invalidations](docs/design-notes.md#authoritative-publication-is-secondary), and
  so is the `update` behind `useInfiniteLane`'s `loadMore`.

  Rename the field at each read site; nothing else changes. `useLane` and
  `useInfiniteLane` return it (`useLanesAll` resolves to values and never had it).
  The noun form is deliberate: an invalidation is instantaneous, so `isInvalidating`
  would claim a duration the verb does not have — what lasts is the convergence
  that is *pending*.

- **Breaking: `staleTime` defaults to `Infinity`, not `0`.** Nothing is stale until
  an app says what stale means. The old `0` was inherited from react-query, where
  it is safe because a mount fetch and a stale refetch are one mechanism; in Lane
  they are two — the read runs during render, the trigger fires from an effect — so
  `0` made a fresh mount with `refetchOnMount: true` fetch twice, the second
  request refreshing the value the first had just loaded. `staleTime` is also the
  rate limit on the trigger it gates, so the old default shipped every app the
  version with no limit.

  What this costs is silence: `whenStale: "refetch"` and the `true` form of
  `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` now do nothing until a
  `staleTime` is set. Both warn once in development (stripped from production
  builds), because an accepted option that does nothing is the failure mode worth a
  word. To keep the previous behaviour, state it: `staleTime: 0`.

- **Breaking: the `"always"` form of `refetchOnMount` / `refetchOnFocus` /
  `refetchOnReconnect` is gone.** All three are `boolean` now. It was inherited from
  react-query, where the same spelling costs nothing on a fresh mount because a
  mount fetch and a stale refetch are one mechanism. Here they are two — the read
  runs during render, the trigger fires from an effect — so `"always"` also
  refetched the value that same mount had just loaded, which is not what anyone
  reaching for it is asking for. Carrying a familiar name with unfamiliar behaviour
  is worse than not carrying it.

  `refetchOnMount: true, staleTime: 0` is the direct replacement, and it states the
  cost instead of hiding it. For an unconditional refresh on your own schedule,
  `lane.invalidate(key, { onlyIf: "settled" })` is unchanged — the primitive stays,
  only the trigger sugar is gone. Note the one behaviour the sugar had to itself: it
  also retried a *first* load that had failed. A failed **refresh** keeps the
  previous value, whose freshness timestamp is left untouched, so `true` still picks
  it up; a first load that never succeeded is retried by an error boundary reset or
  `whenStale: "refetch"` instead. Where that retry belongs is the point. When the
  reader unwraps its own promise it never committed, so no trigger of any kind has a
  subscriber to fire from. When the owner passes the promise down and holds the
  boundary itself it does stay subscribed, and there the unconditional form really
  could have re-read on focus — but the boundary has latched its failed state, so a
  refetch that does not go through a reset cannot put anything back on screen. Both
  shapes are pinned by tests. The retry lives at the boundary reset either way,
  which is the state that has to change.

- **Breaking: every read hook takes one value.** `useLane({ key, loader, ...options })`
  replaces `useLane(key, loader, options)`, and the same for `useLanePromise`,
  `useLanesAll` (whose members were `[key, loader]` tuples), `useInfiniteLane`
  (whose pagination was a second argument), and `Lane.prefetch`. This is the move
  react-query made in v5 for the same reasons: options had two homes, the
  spread-override that makes a shared definition adjustable
  (`useLane({ ...taskLanes.detail(id), refetchOnFocus: true })`) only worked in
  one of them, and every consumer needed an overload pair to accept both. One
  shape means one signature to document, one to infer through, and one to read.
  Nothing about a read changed but where its parts sit, so migration is
  mechanical: `useLane(key, loader, opts)` → `useLane({ ...opts, key, loader })`.
  `LanePrefetchOptions` is gone with the positional `prefetch`; a read carries its
  own `retry` / `retryDelay`.

  It also paid for itself in bytes: dropping the normalization branches left the
  core at **2169 B** against 2167 B before any of this work, and the typical
  `LaneProvider + useLane` import unchanged at **3328 B**. Typechecking a read
  costs about 20% more instantiations than the positional form did (measured over
  40 reads: 4540 → 5505), which is the price of the whole read being one inferred
  object.

- **Reworked the size budgets so each check has a distinct job, and added the
  ceiling.** `.size-limit.json` had two checks, and neither could see the
  regression that costs every consumer: adding a module to the barrel moved
  neither budget, so CI could not observe "everyone now pays for this." The two
  also overlapped almost entirely — the typical check contained every module the
  core check measured, plus more.

  There are now three, each answering a different question:

  | check | import | limit | measures |
  | --- | --- | --- | --- |
  | `store without React (design guard)` | `{ createLane }` | 2.2 kB | 2024 B |
  | `typical: LaneProvider + useLane` | `{ LaneProvider, useLane }` | 3.5 kB | 3327 B |
  | `everything (ceiling)` | `*` | 4.7 kB | 4569 B |

  `createLane (core only)` is renamed to `store without React (design guard)`
  because that is what it always was. Nobody imports `createLane` alone — it
  exists to hand an instance to `LaneProvider`, so a real consumer importing it
  also pays for the provider, and the number read as "what the core costs you"
  when it is really a design tripwire on the store. The limit is unchanged and
  stays deliberately tight for the reason it always was: the budget is what kept
  `{ after }` down to a gate on the notification instead of state on the entry.
  Only the name changed, so the pressure is now legible from the check itself.

  The ceiling is new, and it is the one that sees a new module: adding a
  throwaway export and rebuilding left the other two checks byte-identical at
  2.02 kB and 3.33 kB while only the ceiling moved. Its 4.7 kB leaves 131 B over
  the current 4569 B — narrower than the marginal cost of any feature Lane ships,
  the cheapest being `LaneHydration` at 158 B — so a real feature trips it and has
  to be argued for, while the headroom still absorbs Brotli jitter across
  toolchain bumps. Raising it is a deliberate act with a line here rather than
  silent drift.

  The typical check keeps its 3.5 kB rather than being tightened to hug 3327 B:
  that headroom is the room a feature on the typical path may use before someone
  decides it is worth it, and guarding growth is now the ceiling's job.

  Nothing about the build or the package changed — this is CI configuration and
  documentation only. Per-feature marginal costs (`laneRead` + `laneKey` at
  **+7 B**, `LaneHydration` +158 B, the infinite hook +332 B, `useLanesAll`
  +540 B) are now documented in [Design notes](docs/design-notes.md) instead of
  pinned as their own checks, and CONTRIBUTING explains what each budget is for.
  The README's "about 3.1 kB" for the typical import was stale against a measured
  3327 B and now reads 3.3 kB, alongside the 4.6 kB ceiling.

### Added

- **`LaneRegister` — declare what loaders are handed besides the key.** A loader
  usually needs something the key does not carry: a session, a tenant, an API
  client. Declaring it once makes it available to every loader as `meta`, with no
  read taking it as an argument:

  ```ts
  declare module "use-lane" {
    interface LaneRegister { loaderMeta: WorkspaceCtx }
  }

  <LaneProvider loaderMeta={ctx}>          // required once declared
  laneRead({ key: ["task", id], loader: ({ meta }) => fetchTask(meta, id) })
  ```

  The problem this solves is the *key*, not the plumbing. Binding the context into
  the factory instead — `taskLanes(ctx).detail(id)` — reads fine and makes `.key`
  unreachable from every module that has no context: a mutation, a Server Component
  seed, an error-boundary retry. The workaround is a second map of bare keys, so
  every read exists twice with the loaded type restated by hand and nothing
  checking that the two agree. Keeping the dependency on the lane keeps a read's
  arguments to exactly what decides its key, so `.key` costs nothing to reach.

  The mechanism is react-query's `Register`, and so is the naming asymmetry —
  `loaderMeta` is declared and supplied, `meta` is received, exactly as react-query
  declares `queryMeta` and delivers `context.meta`. The value's *placement* is
  inverted: react-query puts it on the query, Lane puts it on the lane and makes it
  mandatory, which is what lets `meta` be non-optional inside a loader instead of
  always possibly-`undefined`. A single read can still override it
  (`{ ...taskLanes.detail(id), loaderMeta: other }`), and in a batch a member's own
  value wins.

  Nothing about a read's type changes: `LaneReadSpec` gains no type parameter and
  `useLane` gains no overload. **An app that declares nothing is unaffected** —
  `meta` is `undefined`, and the provider prop and `prefetch` argument stay absent.

  Two consequences are deliberate and documented: the type is program-wide (one
  `loaderMeta` per app, since module augmentation is), and the value is **not part
  of any key** — two reads of one key under different meta name the same entry, and
  nothing invalidates when it changes. Scope what it owns into the key, or drop
  those keys on a switch (`lane.removeAll(["tasks"])`).

  **This raised the `everything (ceiling)` size budget from 4.7 kB to 4.85 kB**,
  which is that check doing its job rather than being worked around: it was set
  with 131 B of headroom precisely so a real feature would trip it and have to be
  argued for. `loaderMeta` costs **136 B** and `laneSnapshot` **21 B**, taking the
  full barrel from 4569 B to **4726 B**. Of that, only **31 B** lands on the
  typical `LaneProvider` + `useLane` path (3327 → 3358 B, still against an
  unchanged 3.5 kB), because the delivery is on the provider and the read path;
  the declaration itself is types only and free. The store-only design guard is
  byte-identical. The new limit keeps the same 124 B of headroom, so the next
  feature trips it too.

  Consolidating the three read hooks onto **one context read** paid for part of
  it (−20 B, and one `useContext` per read instead of three). It also improves the
  error a missing provider produces: `useLane must be used within a LaneProvider`
  rather than whichever narrow hook happened to run first.

- **`laneSnapshot(readOrKey, data)`** — one hydration entry, type-checked. An
  object literal lets any `data` through, because `LaneSnapshot.key` is a plain
  `LaneKey`, and a mismatched pair on the seed path does not fail a fetch: it
  hydrates every reader of that key with the wrong shape and surfaces somewhere
  else. `laneSnapshot` infers `T` from the key and checks `data` against it. It
  takes a **read**, not just a key — `laneSnapshot(taskLanes.list(filters), tasks)`
  — so the seed is written against the same definition the browser reads with. No
  loader is called, so it stays a plain Server Component import.

- **`laneRead({ key, loader, ...options })`** — a read's key, its loader, and the
  options it is read with, colocated in one value; react-query's `queryOptions()`
  for Lane. A key factory shares only half of a read: the loader and the options
  stay at each call site, where nothing checks that they belong to that key.
  `useLane({ key: taskKeys.detail(id), loader: () => fetchTasks(filters) })`
  type-checks and is wrong, and two components can read one key with different
  freshness. `laneRead` gives the whole read one place to live, and every consumer
  of a read takes it: `useLane`, `useLanePromise`, `useLanesAll`,
  `useInfiniteLane` (via `infiniteLaneRead`), and `prefetch`. At runtime the factory is identity and there is no registry behind a spec —
  Lane still addresses entries by serialized key, so specs can be rebuilt per
  render, in a handler, or on the server, and nothing needs memoizing for
  identity. A gated read is a spec whose `loader` is `undefined`, unchanged in
  meaning.

- **`laneKey<T>(key)` and `LaneKeyOf<T>`** — a key that carries what its entry
  holds, so `set` and `update` through it are type-checked. This is the same trick
  as react-query's `DataTag`, and it is what keeps the *write* side out of the
  colocation business: publishing, invalidating, and removing address an entry,
  and none of them needs a loader, so requiring the whole read would make every
  mutation path import fetchers — and whatever request context those fetchers
  close over — to name a key it already knows. `laneRead` stamps the tag from its
  loader's return type (`spec.key`), and `laneKey<Task>(["task", id])` declares one
  for the half of a codebase that only writes. A read may be built on an
  already-typed key, though the two are deliberately not checked against each
  other — constraining a read's `key` to `LaneKeyOf<T>` measured at ~65% more type
  instantiations per read, which is a poor trade for catching a mismatch you have
  to construct on purpose. A tagged key is an ordinary
  array at runtime and is accepted anywhere `LaneKey` is; only `set` / `update`
  read the tag, and a plain key still lets the value decide its own type exactly
  as before.

- **`prefetch(read)`** — the one instance method that takes a whole read rather
  than a key, because it is the one that *performs* one. Its `retry` /
  `retryDelay` come from the read; `staleTime` / `whenStale` stay the eventual
  reader's call.

- **`infiniteLaneRead({ key, initialCursor, fetchPage, nextCursor, ...options })`**
  — the same, for `useInfiniteLane`, whose loader is a cursor walk rather than a
  single fetch. `P` and `C` are inferred and checked where the list is defined
  (`nextCursor` must return the cursor `fetchPage` takes) instead of at each call
  site.

- **Per-member options in `useLanesAll`.** A batch is usually derived from a list
  — `ids.map(taskLanes.detail)` — so each member now carries its own options and
  the batch's `options` argument became the fallback for what a member does not
  set. A read behaves in a batch exactly as it would through `useLane`.

- **`current` on the loader context** — the entry's last fulfilled value, or
  `undefined` on a first load, snapshotted when the read is created so every
  retry of that read sees the same input. A loader's contract is to produce the
  value for a key, and for an *accumulated* value — a list scrolled five pages
  deep, a window with an extent, a revision worth sending as `If-None-Match` —
  the recipe for reproducing it is a fact about the value, not about the key.
  Without `current` that fact had to live in the key (every depth a different
  cached list) or in component state (a second copy with a different lifetime,
  which desyncs the first time a component remounts over a live cache). It
  survives invalidation, which clears the cached promise and not the value, and
  disappears with the entry — `remove`, collection, or an invalidation of an
  entry no reader is holding — so a loader must always define what a first load
  means. It is not a way to skip work: returning it unchanged strands the entry
  on stale data. Typed by the read's new second type parameter, `useLane<T, C = T>`,
  which is what keeps `T` in the return position: putting the loaded type in the
  loader's *parameter* position would make TypeScript fix it before checking the
  loader body, and a loader written inline would have silently inferred
  `LaneRead<unknown>`. Annotating the read (`useLane<Feed>({ … })`)
  types `current`; reading it without an annotation is a type error asking for
  one, never a silent `any`.

- **`useInfiniteLane(read)`** — a cursor-paginated list as
  one key holding the whole accumulated list, with the page depth read back out
  of the cached value. `{ initialCursor, fetchPage, nextCursor }` in, `{ promise,
  loadMore, isInvalidationPending, isBackgroundPending, invalidate }` out, and
  `{ pages, params, hasNext }` under the key. `loadMore` appends one page through
  `update`, so the key never changes and the list converges through a transition
  with no `useTransition` of your own; any refresh re-walks the chain as deep as
  the value already is, sequentially, because page N+1's cursor does not exist
  until page N has come back. That last cost is inherent to cursor pagination and
  is the same one React Query's `infiniteQueryBehavior` pays — what differs is
  that the list is held on screen throughout and a failure part-way keeps it
  there with `refreshError` instead of an error state. `hasNext` rides in the
  resolved value rather than on the hook, for the same reason `refreshError`
  does: the hook never resolves the promise, and a flag next to the pages it
  describes cannot disagree with them mid-render. Adds no core machinery — it is
  `useLane` plus an update, and could have been written in userland.

- **`updateEntry(lane, keyId, updater)`** — internal, the update-side twin of
  `invalidateEntry`, with the private entry-taking form renamed `updateLaneEntry`
  to match the existing `invalidateEntry` / `invalidateLaneEntry` convention.
  Addressing an entry by its serialized key is what lets `useInfiniteLane`'s
  `loadMore` be a `useCallback` over its real dependencies instead of holding the
  key array alive in a ref.

- **`invalidate(key, { after })` / `invalidateAll(scope, { after })`** — invalidate
  now, fetch later. The invalidation is announced synchronously, so every reader
  goes pending immediately and keeps its current value on screen through the
  transition, while the actual re-read is held behind `after` and starts the
  moment it settles. This closes the window in
  `startTransition(async () => { await action(); invalidate() })`, where
  notification — Lane's only channel to a reader — fires last and readers show
  nothing for the whole mutation. Use it when one mutation invalidates keys it
  does not return values for — but it is not the default shape: `set` with the
  in-flight promise is strictly better when the action resolves to a key's value,
  `useOptimistic` when the outcome can be shown before it lands, and the plain
  `await action; invalidate()` when the pending signal already sits where the
  user is looking. The docs order those explicitly. `after` decides *when* the reads run,
  never *whether*: a rejected action still leaves the key invalidated, only
  settlement is observed, and the rejection never surfaces through Lane. A gated
  read counts as in-flight, so `onlyIf: "settled"` steps around it.

- **`docs/consistency.md`** — what two readers of one key are guaranteed to show
  each other, and the one arrangement where they can disagree: an urgent
  render-phase read of a key (a fresh mount, or a `key` / lane / `enabled`
  switch) while a transition on that same key is held back by something else.
  States the guarantees that make the ordinary `invalidate` → refetch path safe,
  the single rule that removes both entry points, and why reaching for
  `useSyncExternalStore` or `flushSync` buys the window back at the cost of the
  transition model. Projected into the docs site and the bundled agent skill as
  `references/consistency.md`.
- **One owner per key per subtree**, in `docs/common-mistakes.md`. Dedupe makes
  re-reading a key in a child free in requests, which reads as permission to do
  it — but each reader is another subscription, another pending flag, another
  suspend point, and another thing that has to agree. Read where the data enters
  the screen and pass the value down; read the same key twice only across
  genuinely separate surfaces. Cross-linked from the consistency guide, which is
  where the cost of extra readers is spelled out, and added to the skill's
  gotcha list.

- **`lane.cancel(key)`** — stop a key's in-flight read. Alone among the instance
  methods it does not converge the key: nothing is notified, so subscribed
  readers keep the promise they hold instead of starting again. Where the key
  lands is decided by what it already had — a last fulfilled value is reverted to
  (no `refreshError`, because the caller asked for the stop), and with nothing to
  revert to the read settles rejected, the only end a transition holding no data
  can reach. That rejection is kept rather than cleared: emptying the entry looks
  tidier and quietly undoes the cancel, because a reader mid-transition is still
  trying to reach the key and React's retry of the render it never committed
  turns an empty entry into a fresh load. Cancelling holds whether or not the
  loader forwards its `signal` — one that drops it runs to completion, but its
  result is not adopted. Cancelling a settled read does nothing; use `invalidate`
  or `remove` to discard a value. **Only cancel a read you issued and that
  nothing else is reading**: a request left behind by a superseded transition
  (switching tabs, retyping a search) was never issued by the caller at all, and
  is the one place not to reach for this. There is deliberately no `cancelAll`
  and no bound `cancel` on `useLane`'s result: the scoped twins exist for
  operations that converge, and cancelling an unenumerated family would leave a
  rejection on an unknown number of keys — while a bound form would be safe but
  carried by every reader and called by almost none.

### Fixed

- **An explicit `undefined` on a `useLanesAll` member no longer shadows the
  batch's option.** A member's options are resolved against the batch's option by
  option with `??` instead of by spreading the member over the batch. The two agree
  on every input but one, and it is one a caller writes by accident:
  `staleTime: props.staleTime` where the prop is optional type-checks under
  `strict`, and the spread let that `undefined` shadow the batch's value and drop
  the member to the built-in `staleTime: 0` — so a batch-wide minute became "always
  stale", and `refetchOnMount` refetched every member it should have skipped.
  `undefined` now means *unspecified* here as it does everywhere else in Lane (the
  read path resolves `options?.staleTime ?? 0`, an absent loader gates a read off,
  an absent trigger is off); a member that names a *value* still wins, unchanged.
  This was the only place in the library with two tiers to disagree about, so it
  was the only place the distinction was observable. Naming the seven options also
  drops `key` / `loader`, which the spread carried along inert. Costs 76 B on the
  `useLanesAll` path (951 → 1027 B minified + gzipped); neither tracked budget
  covers that module, and both are unchanged.

- **`whenStale: "refetch"` no longer loops on the second visit to a key.**
  Returning to a key that had already been mounted once refetched, suspended,
  and then refetched again on every retry of the render that had not committed
  yet — never settling, so the requests never stopped. The guard that exists to
  prevent exactly this was keyed on the *entry* ("has this key ever had a
  subscriber"), which stays true forever once the key has been mounted at all,
  so it stopped protecting after the first visit. Adoption is now tracked on the
  cached promise itself: only a value some reader actually committed on is
  discarded as stale, so a remount refetches once and the retries that follow it
  reuse what that refetch produced. First mounts and prefetched or hydrated
  values are unaffected.

- A reader that subscribes just too late to receive a notification — it committed
  on the previous promise and only finds the change when its subscription effect
  runs — now converges through the same kind of transition that notification
  used, instead of always the background one. Siblings reading the same key no
  longer disagree about whether an update is `isInvalidationPending` or
  `isBackgroundPending`.

### Changed

- **`"use client"` is now a per-file boundary, so keys and read definitions work
  in Server Components.** The build emitted one bundle per format, so the single
  directive on `src/index.ts` made the *entire* package client-only: a Server
  Component that imported any value got a client reference, and calling
  `laneKey(...)` there failed with "Attempted to call laneKey() from the server."
  The RSC seed path felt it directly — the module building hydration snapshots had
  to stay server-safe, which meant writing key literals in one module and
  attaching their types in another, duplicating the list.

  `dist/` now holds one output file per source module, the way react-query's
  `build/modern/` does, and the directive sits on the five modules that touch
  React (`provider`, `hydration`, and the three hooks) instead of on the barrel.
  `laneKey`, `laneRead`, and `createLane` are importable from a Server Component,
  and one key module can serve both halves of an RSC-seeded route.

  Nothing moved in the public API: the entry is still a single `"."` export with
  no `/server` or `/client` subpaths, imports stay `from "use-lane"`, and with
  `sideEffects: false` a server-graph import of `laneKey` tree-shakes every
  client-marked file away — verified as pulling `keys`, `structural`, `core`, and
  `read-spec`, none of them client-marked.

  Both size budgets are unchanged, and files a consumer does not reach are now
  droppable per file rather than per bundle: `createLane (core only)` measures
  **2024 B**, down from 2169 B, and `LaneProvider + useLane` **3327 B**, down from
  3328 B.

- **`remove` / `removeAll` now drop the entry's last fulfilled value**, not just
  its cached promise. Removal means the entry no longer belongs in client state —
  sign out, team switch, a deleted entity — and it could not rely on deleting the
  entry to enforce that, because an entry a reader still holds survives the
  removal: the key slot stays. Anything left on it outlived the sign-out, and
  that value backs both the stale-on-error fallback and the `current` handed to
  the next loader, either of which would have served removed data back. Only
  affects apps that `remove` a key a mounted reader still holds and then fail or
  re-read it.

- Raised the `createLane (core only)` size budget from 2 kB to 2.1 kB. It sat at
  1.98 kB beforehand, with no room left for a feature. Deliberately tight — the
  budget is what kept `{ after }` down to a gate on the notification instead of
  state on the entry.

- Reframed the public documentation around Lane's core model:
  **Promise-first. Transition-native.** Lane keeps each keyed read's promise in
  React state and stays minimal by leaving loading, errors, pending, and
  optimistic UI to React.

## [0.7.0] - 2026-07-08

### Added

- **Run Lane in any React renderer — CLI (Ink), React Native, and beyond.** The
  provider's focus / reconnect signals now come from a pluggable `eventSource`
  prop on `LaneProvider` instead of hard-wired `window` / `document` listeners.
  Three sources ship: `domEventSource` (default — browser events, feature-detected
  so it safely no-ops off the web), `noopEventSource` (opt out, e.g. a CLI), and
  `createReactNativeEventSource({ AppState, netInfo? })` (React Native, with the
  native modules passed in so Lane never depends on `react-native`). The store and
  hooks were already DOM-free, so this removes Lane's last browser coupling.
  **Fully backward compatible** — existing web apps need no change; the default is
  the previous behavior. New type exports: `LaneEventSource`,
  `LaneRevalidateHandlers`, `ReactNativeAppState`, `ReactNativeNetInfo`,
  `ReactNativeEventSourceOptions`. See
  [docs/environments.md](./docs/environments.md).

### Fixed

- **`whenStale: "refetch"` no longer loops on mount with a small `staleTime`.** A
  reader that suspends re-runs its read on every pre-commit retry, and React
  discards a component's fiber (state and refs alike) until its first commit — so
  a not-yet-mounted entry is indistinguishable from an idle remount (settled
  cache, zero subscribers). With `staleTime` at or near `0`, `"refetch"` judged
  the just-settled value stale on each retry, discarded it, and refetched forever
  without committing (worse with sibling reads: a fast read went stale while
  waiting on a slow one). A stale fulfilled value is now discarded only on a
  genuine remount of previously-adopted data (an entry that has had a live
  subscriber); a first adoption — a pre-commit retry or a prefetched/hydrated
  value being read for the first time — reuses the value instead. Prior errors
  are still always retried. Use `refetchOnMount` to force a fresh load on first
  mount.

## [0.6.0] - 2026-07-07

### Added

- **`useLane(...).invalidate` accepts `LaneInvalidateOptions`** — the reader-bound
  `invalidate` now takes the same `{ background, onlyIf, staleTime }` as
  `lane.invalidate`, routed through the same path. It is render-stable and bound to
  the read's key, so a self-scheduled poll can call
  `invalidate({ background: true, onlyIf: "settled" })` directly — no external key
  to thread, and no re-arm on unrelated re-renders.
- **Migration guide** (`docs/migrating.md`, bundled in the agent skill): the React
  Query / SWR mental-model map, transitional-adapter cautions, the resilient panel
  pattern, deferred search, and a checklist.
- **Common mistakes: "Suspense boundaries decide what stays mounted"** — ephemeral
  UI (modal / popover / combobox / tab panel) needs its own Suspense boundary, or it
  unmounts when an initial read suspends.

### Fixed

- Removed stale `refetchInterval` references from the docs, README, and agent skill
  left over from its removal in 0.5.0 (the API reference was already correct).

## [0.5.0] - 2026-07-06

### Changed

- **Removed `refetchInterval`; polling is now userland.** There is no core polling
  timer. A poll is a self-scheduled invalidation written with primitives (the same
  stance Lane takes on mutations): an effect that reschedules after each
  `use(promise)` load — so it never fires mid-flight — or a `setInterval` with
  `{ onlyIf: "settled" }`. This shrinks the core (no `recomputePolling` /
  per-entry poll timer) and drops the per-subscriber `refetchInterval` option.
- **`invalidate` / `invalidateAll` accept `{ background: true }`.** It converges
  through the background transition (`isBackgroundPending`) instead of the default
  explicit one (`isInvalidationPending`) — what a self-scheduled poll uses so an
  automatic refresh doesn't read as a user-driven invalidation. New field on
  `LaneInvalidateOptions`.

### Added

- **`useLanesAll(reads, options?)`** — read a *dynamic* set of `[key, loader]`
  pairs with a single hook (a fixed number of hooks regardless of count) and get
  back one **stable, `use()`-able `Promise.all`** of their values. Each pair is
  its own keyed read (independently cached, subscribed, and invalidatable,
  behaving like `useLane`); `options` are shared by every read, and a read is left
  out by omitting it (loader is required — no per-item gating). The hook's job is
  to own a stable aggregate identity that `use(Promise.all(...))` built inline
  can't (fresh promise every render; dead-loops on rejection). `use(promise)`
  resolves to every read positionally, rejects to the Error Boundary on any
  initial-load failure, and swaps inside a transition when a member changes (a
  background refresh keeps the previous values on screen). No `combine` option
  (Lane is suspense-based, so an aggregate is all-or-nothing — combine in render).
  Built by composing core primitives (`readOrCreate` / `subscribeLane` /
  `invalidateEntry`) — it adds no public API beyond the hook. For rendering N
  independent rows, render a child per row that calls `useLane` instead.

## [0.4.1] - 2026-06-28

### Added

- **"Common mistakes" documentation page** covering use-lane anti-patterns —
  reading a promise in an effect instead of `use()`, hand-rolled loading state,
  patching the cache after a mutation, deferring reads off the critical paint,
  editing loaded data as a local draft, transitioning prop-driven key changes,
  unstable keys, dropped abort signals, and more. Projected into the bundled agent skill as `references/common-mistakes.md`
  and linked from `SKILL.md`.

## [0.4.0] - 2026-06-27

### Added

- **Agent skill bundled in the package.** The npm tarball now ships an
  [Agent Skills](https://agentskills.io/)–format skill at
  `skills/use-lane/SKILL.md`, with the full documentation projected alongside it
  under `skills/use-lane/references/`. AI coding agents can load it from
  `node_modules/use-lane/skills/use-lane/SKILL.md` for use-lane-aware guidance
  that is version-locked to the installed package. `docs/*.md` stays the single
  source of truth; the skill (and the Nextra site) are generated from it via
  `pnpm docs:sync`.

## [0.3.0] - 2026-06-23

### Added

- `whenStale?: "revalidate" | "refetch"` read option for `useLane` /
  `useLanePromise`, controlling what a read does when the cached value is stale
  (older than `staleTime`). `"revalidate"` (default, the existing behavior)
  reuses the cached value and refreshes in the background; `"refetch"` discards
  an idle stale value (or a prior error) and suspends on a fresh load, but never
  discards an in-flight read or a value a live subscriber is showing.

### Changed

- **Breaking:** a read now resolves to `LaneRead<T> = { data, refreshError? }`
  instead of `T`. `use(result.promise)` returns `{ data, refreshError }` (unwrap
  `data`), and `set` / `update` / `updateAll` resolve to `LaneRead<T>` as well.
  The separate `refreshError` field on the `useLane` result is **removed** — on a
  stale-on-error refresh the error now travels *inside* the resolved value,
  alongside the `data` it accompanies. This keeps `data` and `refreshError` from
  tearing apart under concurrent rendering and removes a render-time read of
  mutable store state (a render-purity violation). New public type `LaneRead<T>`.
- **Breaking:** `gcTime` moved from a per-`useLane` option to an instance-level
  option on `createLane({ gcTime })` — an instance-wide memory policy rather than
  a per-read concern. The per-hook `gcTime` (and its "largest across subscribers
  wins" rule) is removed.
- Garbage collection now runs as a single coalesced sweep per lane, armed only
  when an entry loses its last subscriber, instead of a per-entry timer armed at
  cache-set. Timing is approximate but the read path no longer arms timers; the
  lane-wide sweep also reclaims orphaned (never-committed) entries.

## [0.2.0] - 2026-06-18

### Changed

- **Breaking:** removed the `enabled?: boolean` option. Gate a read by passing
  `undefined` as the loader instead
  (`useLane(key, cond ? loader : undefined)`). Lane loads external data only, so
  an absent loader has no other meaning and is the single, unambiguous disable
  signal. Gating through the loader keeps the loaded type unaffected (the
  off-state stays on the `promise: undefined` axis, so `Awaited<promise>` is
  still `T`) and lets the loader's inputs narrow without a non-null assertion.
  Disabled reads still fetch nothing, create no subscription, and store no
  entry; supplying the loader is treated as a mount (re-subscribe +
  `refetchOnMount`).

## [0.1.1] - 2026-06-17

### Added

- `enabled?: boolean` option for `useLane` / `useLanePromise`. When `false`, no
  loader runs and no subscription is created, and the result's `promise` is
  `undefined` (new `LaneGatedResult<T>`). Overloads keep callers that omit
  `enabled` (or pass `true`) at the non-nullable `LaneResult<T>`. Flipping
  `enabled` back to `true` is treated as a mount (re-subscribe +
  `refetchOnMount`).

## [0.1.0] - 2026-06-13

Initial public release.

### Added

- `useLane(key, loader, options)` returning `{ promise, refreshError,
  isInvalidationPending, isBackgroundPending, invalidate }`, plus the
  `useLanePromise` convenience wrapper.
- `LaneProvider` / `useLaneInstance` and standalone `createLane()`.
- Exact and scoped (`prefix` / predicate) `invalidate`, `set`, `update`, and
  `remove` operations on the `Lane` instance.
- Invalidation-driven re-reads through transitions, with explicit (`transition`)
  and background (`focus` / `mount` / polling) sources kept separate.
- `LaneHydration` snapshots that overwrite authoritatively and notify mounted
  readers, so navigations surface fresh server data (RSC seeding).
- Stale-on-error: a failed refresh keeps serving the last fulfilled value and
  reports through `refreshError`; only initial loads reach the Error Boundary.
- Garbage collection (`gcTime`, default 5 minutes after the last unsubscribe).
- Loader context with `AbortSignal` (aborted on invalidate / remove / set / GC)
  and opt-in `retry` / `retryDelay`.
- Structural sharing so deep-equal reloads keep referential identity.
- Polling via `refetchInterval` (smallest interval across subscribers,
  settled-only ticks so pending reads dedupe).
- `refetchOnFocus` (window focus + `visibilitychange`, coalesced by
  `focusThrottleInterval`, default 5s), `refetchOnMount`, and
  `refetchOnReconnect` (`online` event) revalidation.
- `Date` key segments (serialized by timestamp, stable for invalid dates).
- ESM + CJS bundles with type definitions, preserving the `"use client"`
  directive.

### Requirements

- React 19.2+ (`useEffectEvent`).

[Unreleased]: https://github.com/KentoMoriwaki/lane/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/KentoMoriwaki/lane/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/KentoMoriwaki/lane/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/KentoMoriwaki/lane/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/KentoMoriwaki/lane/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/KentoMoriwaki/lane/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/KentoMoriwaki/lane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/KentoMoriwaki/lane/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/KentoMoriwaki/lane/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KentoMoriwaki/lane/releases/tag/v0.1.0
