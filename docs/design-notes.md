# Design notes

Why Lane is shaped the way it is. For *how* to use it, see the
[API reference](./api-reference.md); for where it fits, see
[supported architectures](./architectures.md).

The throughline: **Lane owns promise identity; React owns UI state.** Every
decision below follows from keeping that split clean.

## Source invalidation is the primary convergence model

Lane makes source invalidation the main way to converge after a mutation:

```txt
mutate source -> invalidate affected read -> render from the next promise
```

This mirrors the Server Component model (`mutate -> revalidate -> render from the
next data`). A Lane app usually thinks "this source changed; read it again"
rather than "patch this external cache."

Invalidation is render-driven. Lane does not eagerly refetch away from render the
way a query cache can. When an entry is invalidated, mounted readers re-read in a
transition and create the next promise from their current loader; inactive
entries stay invalidated and fetch when next read. That is why Lane core never
has to store loaders for later refetch — the reader that owns the read provides
the loader.

## Transition-native by construction

Lane keeps each key's promise in React state (via `useState` + `useTransition`),
not in an external store read during render. That single choice is what makes
updates transition-native: when an entry is invalidated, set, or refetched, the
hook swaps the promise inside `startTransition`, so React keeps rendering the
last value until the next one resolves, then commits. The previous screen stays
mounted and interactive — no fallback flash, no tearing.

Because the data lives in React state, this is not a bespoke `keepPreviousData`
flag like a query cache needs; it is the same transition model the rest of the
app already uses. Callers compose it directly: wrap a filter change in
`startTransition`, or derive the key and loader from a `useDeferredValue` input,
and deferred behavior falls out for free. Background revalidations (focus, mount,
polling, reconnect) run on a separate transition surfaced as `isBackgroundPending`,
so automatic refreshes never block an interaction.

Two deliberate exceptions keep the claim honest: an initial load with no prior
value suspends to a Suspense fallback — a transition can only preserve UI that
already exists — and `remove` is urgent rather than transition-preserving, so
stale data cannot linger after sign-out or a team switch.

## React owns UI state

`useLane` deliberately returns no query-result fields — no `data`, `error`,
`isLoading`, `isError`, `isSuccess`, or `status`. Data is read with
`use(promise)`, loading is a `Suspense` fallback plus transition pending state,
and errors go to Error Boundaries. There is no parallel state machine to keep in
sync with React's own.

For the same reason **Lane ships no mutation helper**. Mutations are written with
React primitives — `useActionState`, `useOptimistic`, transitions — exactly as
they are next to Server Components and Server Functions. One mental model is worth
more long-term than a convenient wrapper that diverges from it.

## Optimistic state is local

React Query-style optimistic updates often write speculative data into the shared
cache, making it visible to every consumer until rollback. Lane does the
opposite: optimistic state stays local to the component or workflow that started
the action, via `useOptimistic`. The rest of the app keeps rendering current
promise-backed data until the source is invalidated and re-read, or an
authoritative value is published.

The tradeoff is intentional:

- optimistic UI stays close to the action that produced it
- Lane needs no global optimistic cache and no rollback/revert semantics
- distant consumers never observe speculative data
- app-wide consistency comes from confirmed data, not optimistic patches

## Refresh errors serve stale data

A failed *refresh* must not destroy data the user is already looking at. When an
entry has a last fulfilled value and its next read rejects — after invalidation,
a focus refetch, polling, or a `set` of a rejecting promise — the cache falls
back:

- the cached promise resolves with `{ data, refreshError }` — the last fulfilled
  value plus the error — so `use(promise)` keeps rendering instead of throwing
- the failure rides *inside the resolved value*, not a side channel: a reader
  gets `data` and `refreshError` from the same `use(promise)`, so they can never
  tear apart under concurrent rendering, and nothing reads mutable store state
  during render
- freshness keeps the original fulfillment time, so staleness policies still
  treat the data as old and retry naturally
- the next successful read resolves to `{ data }` with no `refreshError`

Only initial loads — reads with no previous fulfilled value — reject and reach
the Error Boundary. This preserves the boundary model for "there is nothing to
show" while keeping "there is something to show" rendered through background
failures. `refreshError` is deliberately not named `error` for this reason.

Carrying the error in the resolved value (rather than exposing it as a separate
field on the hook result) is what makes this consistent: the promise is a single
React-state snapshot, and `use()` is the only read path, so `data` and
`refreshError` always reflect the same point in time.

## Authoritative publication is secondary

Invalidation is primary, but Lane can also publish already-confirmed data to an
exact key with `set` (and derive from the current value with `update`).
Conceptually `set` is a *prefilled invalidation*: store the next promise, then
notify subscribers through the same path. It is useful when the app already has
server-confirmed data and wants to avoid an immediate duplicate read — a create
response seeding a detail key, or an update response publishing the confirmed
entity while broader derived reads are invalidated.

`set` is not optimistic UI. It publishes data the app actually has.

## Hydration overwrites

`LaneHydration` applies server snapshots as authoritative values: it overwrites
existing entries and notifies subscribers. Navigation is the reason — when a
route transition re-hydrates the same keys with fresh server data, mounted
readers must converge. A set-only-if-absent seed would keep rendering the
previous page's data after navigation.

Idempotency lives at the boundary, not in the store operation: a given snapshots
instance is applied to a given lane at most once, so repeated renders and Strict
Mode do not re-publish. A new snapshots instance from a new server render is
intentionally authoritative.

## Key matching: exact vs scoped

Lane supports two matching modes, and the **caller** chooses which — Lane never
infers it from key shape:

- exact-key operations for one concrete read (`["task", id]`, `["labels"]`)
- prefix- or predicate-scoped operations for families of existing reads
  (`["tasks", filters]` invalidated through the `["tasks"]` prefix)

Scoped operations only touch entries that already exist; the app never enumerates
every key that could exist. Keys stay structural — the implementation derives a
canonical id for lookup but compares key *segments*, not raw string prefixes, for
scoped matching.

`remove` is distinct from invalidation: it means the entry no longer belongs in
client state (sign out, team switch, deleted entity), so its notification is
urgent rather than transition-preserving.

## A deliberately small core

Lane core owns only the lifecycle facts that must stay consistent for a key slot:
canonical identity, the optional cached promise, its start and settlement
timestamps, and exact-key subscriptions. It does **not** keep a separate
resolved-value store or `useQuery`-style status fields.

Everything time- or activity-based is policy layered over those primitives
through conditional invalidation, not baked into the core data structure:

```txt
adapter option -> conditional cache invalidation -> mounted readers re-read through the existing subscription path
```

- mount-time stale refresh (`refetchOnMount`)
- focus / reconnect revalidation (`refetchOnFocus`, `refetchOnReconnect`)
- polling (`refetchInterval`)
- retry / backoff (`retry`, `retryDelay`)
- inactive-entry garbage collection (`gcTime`, a per-lane policy on `createLane`)

Splitting the durable key slot from its optional cached promise is what makes
this work: invalidation clears the cache and notifies readers; the first reader
to re-read creates the next promise and the rest dedupe onto it. No low-level
reload API, version field, or separate invalidated flag is needed, and stale
promises that settle late are ignored by comparing cache-object identity.

## Design bias

When more than one approach is possible, Lane prefers:

- invalidating source data over patching cache entries
- exact-key operations for single reads, scoped operations for key families
- exact-key publication only for authoritative values already in hand
- local React state for optimistic UI, not shared cache writes
- app-level decisions for mutation effects
- coordinating promise identity over owning resolved-value cache policy

## See also

- [API reference](./api-reference.md)
- [Common mistakes](./common-mistakes.md)
- [Supported architectures](./architectures.md)
