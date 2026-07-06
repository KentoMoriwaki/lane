# Changelog

All notable changes to `use-lane` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/KentoMoriwaki/lane/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/KentoMoriwaki/lane/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/KentoMoriwaki/lane/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/KentoMoriwaki/lane/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/KentoMoriwaki/lane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/KentoMoriwaki/lane/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/KentoMoriwaki/lane/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KentoMoriwaki/lane/releases/tag/v0.1.0
