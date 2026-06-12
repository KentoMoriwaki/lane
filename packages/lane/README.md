# @lane/lane

Prototype package for the `lane` client data library: a promise-identity cache
for React 19. Lane coordinates which promise a key currently renders;
React primitives own everything else — `use(promise)` for data, Suspense for
loading, Error Boundaries for initial errors, transitions for convergence, and
`useOptimistic` / `useActionState` for mutations. Lane intentionally ships no
mutation helper.

Requires React 19.2+ (`useEffectEvent`).

## Current capabilities

- `useLane(key, loader, options)` returning `{ promise, refreshError,
  isTransitionPending, isBackgroundPending, invalidate }`
- invalidation-driven re-reads through transitions, with explicit
  (`transition`) and background (`focus`/`mount`) sources kept separate
- exact and scoped (`prefix`/predicate) `invalidate` / `set` / `update` /
  `remove` operations
- `LaneHydration` snapshots that overwrite authoritatively and notify mounted
  readers, so navigations surface fresh server data
- stale-on-error: a failed refresh keeps serving the last fulfilled value and
  reports through `refreshError`; only initial loads reach the Error Boundary
- garbage collection (`gcTime`, default 5 minutes after the last unsubscribe)
- loader context with `AbortSignal` (aborted on invalidate/remove/set/GC) and
  opt-in `retry` / `retryDelay`
- structural sharing so deep-equal reloads keep referential identity

Design notes:

- `../../docs/lane-api-design-notes.md`
- `../../docs/lane-use-lane-reference.md`
- `../../docs/lane-library-requirements-from-react-query-baseline.md`
- `../../docs/lane-query-lifecycle-requirements.md`
