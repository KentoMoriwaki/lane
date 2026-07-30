# Changelog

All notable changes to `use-lane` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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

### Added

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
  loadMore, isTransitionPending, isBackgroundPending, invalidate }` out, and
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

- **`createLane({ defaults })`** — an app-wide floor under every read option;
  react-query's `defaultOptions.queries` for Lane. A read being one value said
  where its options live, not what they are when the read does not care, so the
  freshness an app wants everywhere had to be written on every read and was free to
  drift at any of them. `defaults` takes the same `LaneUseOptions` a read takes —
  all seven options, so nothing is defaultable-in-principle-only — and precedence
  is one line: **the read's own option > `useLanesAll`'s shared options >
  `defaults` > built-in.**

  It sits on the *instance* rather than in context because `prefetch` runs outside
  React — a router loader, an RSC, a link's `onMouseEnter` — and defaults that only
  reached `LaneProvider` would leave exactly the path that cannot see context on
  the bare built-ins, making "app-wide" a claim about the component tree instead of
  about the app. The instance is what every path already holds, and where `gcTime`
  already lives. `prefetch` still pins `whenStale: "revalidate"` and ignores
  `staleTime`, so a lane-wide `"refetch"` cannot turn a repeated warm-up into a
  refetch; `retry` / `retryDelay` do reach it.

  Nothing is merged. Options are never normalized into a copy in Lane — a read
  *is* its options bag — so each default is resolved with `??` where that option is
  already read: four on the read path in core, three at fire time in the hooks, for
  the triggers the store never sees. A cache hit allocates nothing, and the tier
  cost **29 B** (core 2169 → 2198 B; `LaneProvider + useLane` 3328 → 3390 B). Per
  *option* rather than per bag, which is what makes it useful: a read that only
  turns `refetchOnFocus` on still judges freshness against the lane's `staleTime`
  instead of having to restate it.

  Two things to know. `undefined` means *unspecified*, so a read opts out by
  writing the built-in (`staleTime: 0`, `refetchOnFocus: false`) rather than by
  writing nothing — distinguishing absent from present-and-`undefined` would mean
  `in` checks on every option and would give the shape a hook happens to pass a
  meaning it was never designed to carry. And they are fixed at construction: a
  default is read when a load starts and when a trigger fires, so a mutable one
  would be an external mutable source read during render, and could never reach a
  promise the lane had already cached.

  There is no per-key tier — react-query's `setQueryDefaults(key, …)` has no Lane
  equivalent, because `laneRead` already gives one read's options one home and a
  key-prefix registry would put read policy back in the store, which holds no
  loaders and now no options either. `gcTime` stays a sibling rather than a
  default (no per-read counterpart to fall back from), and the `staleTime` on
  `invalidate(key, { onlyIf: "stale" })` stays untouched: it is a threshold
  argument to an operation, not an option a read left unspecified. The rule is one
  sentence — *a default fills in an option a read did not specify.*

  Migrating from react-query, port the defaults you were relying on and not only
  the ones you wrote: it ships `retry: 3` and all three refetch triggers on, while
  every Lane built-in is off.

### Fixed

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
  longer disagree about whether an update is `isTransitionPending` or
  `isBackgroundPending`.

### Changed

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
  explicit one (`isTransitionPending`) — what a self-scheduled poll uses so an
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
  isTransitionPending, isBackgroundPending, invalidate }`, plus the
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
