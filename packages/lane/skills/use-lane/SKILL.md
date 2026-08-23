---
name: use-lane
description: Use when writing or reviewing React 19 async-data code that uses use-lane — reading data with useLane + use(), Suspense / Error-Boundary wiring, re-reading after a mutation (invalidate / set / update), refetch / polling / focus / reconnect revalidation, conditional or deferred reads, RSC or router-loader publication (LaneHydration + `loader: external`), router / Next.js integration, prefetching, or migrating React Query / SWR code. Lane owns promise identity; React owns loading, errors, transitions, and optimistic UI — prefer source invalidation over external-store cache patterns. Also use it to avoid common anti-patterns: reading a promise in useEffect/.then + setState instead of use(), hand-rolled isLoading, or patching the cache after a mutation.
---

# use-lane

**Promise-first. Transition-native.** `use-lane` keeps each keyed read's
**promise** in React state and replaces it inside React transitions. It does
**not** own a resolved-value cache or status flags — React owns loading
(Suspense), errors (Error Boundaries), pending (`useTransition` /
`isInvalidationPending`), and optimistic UI (`useOptimistic`).

**The one rule that explains every API: Lane owns _promise identity_; React owns
_UI state_.** When something looks missing — no `isLoading`, no `useMutation`, no
cache-patching API — it is missing on purpose. Reach for the React primitive
instead of recreating a React Query / SWR cache on top of Lane.

## When to use

- A client component reads async data and must re-read it after a mutation, on
  focus / reconnect, on an interval, or when a key (filter / search / id) changes.
- You want refetches to stay non-blocking — the current screen stays live — via
  transitions, not a library `keepPreviousData` flag.
- A key's truth lives outside the browser (an RSC payload, a router loader) and
  client components must read it reactively — publish it and read with
  `loader: external`.
- You are migrating React Query / SWR code to the React-19-native split.

**Not for:** data no client component reads reactively (pass it as RSC props), or
as a global store for mutation / optimistic state (that stays local to the action
via `useOptimistic` / `useActionState`).

## Minimal shape

```tsx
// Read: Lane returns the promise; use() unwraps it; Suspense + Error Boundary do the UI.
const { promise } = useLane({
  key: ["user", id],
  loader: ({ signal }) => fetchUser(id, signal),
});
const { data } = use(promise); // { data, revision, error? } — no isLoading / isError / status

// Converge after a mutation: change the source, invalidate the key, re-read.
const lane = useLaneInstance();
await patchUser(id, body);
lane.invalidate(["user", id]); // mounted readers re-read inside a transition
```

## Ownership: decide it per key, first

| The key… | Put it | Reads with | Changes through |
| --- | --- | --- | --- |
| is not read reactively by a client component | not in the lane — RSC props | — | a new render |
| is read by the client, truth lives outside | in the lane, **published** (`LaneHydration`) | `loader: external` | `set` / `update` for what a mutation returned; `invalidate` for what derives from it (Lane asks the owner via `refresh`); or mutate source → revalidate → republish |
| is the client's to control | in the lane, **client-owned** (never seeded) | a normal loader | `invalidate` / `set` / `update` / `remove` |

**An external read is an ordinary read whose loader the owner holds:** the value
arrives by publication, and a re-read asks the owner to publish again. `useLane`
returns the same `LaneResult` it does anywhere, and the whole client mutation
surface works. Two things stay different: the read spec takes **no freshness
options** (`staleTime` / `refetchOn*` — freshness is the owner's), and
`lane.prefetch` throws `LaneOwnershipError` (there is no loader to run but the
owner's route). Give the lane the ask: `<LaneProvider refresh={() =>
router.refresh()}>`. Optimism is still `useOptimistic` over the read value —
`set` is for a value you have, never a guess.
→ `references/architectures.md#the-ownership-rule`,
`references/api-reference.md#external--a-read-the-owner-publishes`,
`references/api-reference.md#refresh--the-owner-ask`

## Core rules (skim before writing code)

Each rule points to the reference that explains it. Read the reference when the
task touches that rule.

- **Read with `use(promise)`** — never store `data` in your own state or an
  external store. `use()` yields `{ data, revision, error? }`; `useLane` itself
  has no `isLoading` / `isError` / `status`. → `references/common-mistakes.md`, `references/design-notes.md`
- **Keep keys stable and serializable.** Lane dedupes by key, not by loader, so a
  key that changes every render refetches every render; the loader itself can be an
  inline closure (no `useCallback` needed). → `references/common-mistakes.md`
- **Colocate a read with `laneRead`** when a key is used in more than one place.
  `laneRead({ key, loader, ...options })` is Lane's `queryOptions()`, so a key
  can't drift away from its loader or its freshness. **Reads take the definition**
  (`useLane` / `useLanePromise` / `useLanesAll` / `prefetch`); **entry operations
  take its `key`** (`invalidate` / `set` / `update` / `remove` / `cancel`), because
  none of them needs a loader. The key carries the loaded type (`LaneKeyOf<T>`, the
  same trick as react-query's `DataTag`), so `set` / `update` through it are
  checked; `laneKey<T>(key)` declares one for a write-only module. Scoped `*All`
  operations still take a prefix or predicate scope.
  → `references/api-reference.md#lanereadspec--key--loader-colocation`
- **Never bind a request context into the read factory.** `taskLanes(ctx).detail(id)`
  reads fine and makes `.key` unreachable from every module that has no `ctx` — a
  mutation, a Server Component seed, an error-boundary retry — which is what forces
  a second, hand-typed map of bare keys. Declare the dependency once instead
  (`declare module "use-lane" { interface LaneRegister { loaderMeta: Ctx } }`),
  supply it at `<LaneProvider loaderMeta={ctx}>`, and read it as `loader({ meta })`.
  A read's arguments then stay exactly what decides its key. The obligation: the
  meta is **not part of the key**, so nothing invalidates when it changes — scope
  what it owns into the key, or `lane.removeAll(prefix)` on a switch.
  → `references/api-reference.md#laneregister--what-loaders-are-handed-besides-the-key`
- **Seed hydration with `laneSnapshot(read, data)`,** not an object literal. A
  literal's `key` is an untyped `LaneKey`, so a mismatched pair compiles and seeds
  every reader of that key with the wrong shape; `laneSnapshot` infers the type
  from the read's key and checks `data` against it. Everything seeded becomes
  external — read it with `laneRead<T>({ key, loader: external })` (explicit `T`;
  the spec accepts no `staleTime` / `refetchOn*`, because freshness is the
  owner's). An external read suspends until the publication arrives; once the key
  has held a value and lost it, a read asks the owner through the lane's
  `refresh` and fails with `LaneExternalTimeoutError` after 10s if nothing
  answers (the entry then keeps no cache, so a retry really retries).
  `LaneHydration` is not server-specific: a client router's loader data is a
  payload too. Published entries are exempt from `gcTime` — they live as long as
  the publisher's payload or a committed reader keeps them reachable, while the
  *shell* is never collected, so a later read knows to ask.
  → `references/api-reference.md#external--a-read-the-owner-publishes`
- **One owner per key per subtree.** Dedupe makes re-reading a key in a child
  free in requests, but each reader is another subscription, pending flag, and
  suspend point — read where the data enters the screen and pass the value down.
  Read the same key twice only across genuinely separate surfaces.
  → `references/common-mistakes.md`, `references/consistency.md`
- **Run a mutation inside `startInvalidationTransition`** (returned by `useLane`)
  when readers should look busy *during* it, not after. `await action();
  invalidate()` can only notify at the end, so the whole request shows stale data
  with no sign of activity. Other keys the mutation touches join with
  `lane.startInvalidationTransition(scope)` called *inside* the action — a helper
  announces its own reach, its caller does not enumerate it — and they are
  announced in the same tick, so every reader goes pending together and converges
  on one commit. Lane never touches the action: converge inside it, and catch its
  failure there (a failed save is not `error`).
  → `references/api-reference.md#startinvalidationtransition--pending-from-the-start-of-an-action`
- **Converge by invalidating the source**, not by patching a cache. Use `set` /
  `update` only to publish data you *already have* (e.g. a mutation response);
  use `remove` to drop entries on sign-out / team switch. All of it works on a
  **published** key too — there `invalidate` empties the entry and the next
  reader to need it asks the owner. The alternative on a published key is to
  mutate the source and revalidate: the response carries the re-rendered route,
  so the republication converges every seeded key at once and nothing is left for
  Lane to do. → `references/api-reference.md`,
  `references/api-reference.md#writing-to-a-published-key`,
  `references/integrations.md#the-two-mutation-channels`
- **Wrap key changes and navigation in a transition** (or drive the key from
  `useDeferredValue`) so the current screen stays live. Initial loads with no
  prior value still suspend to a Suspense fallback. → `references/integrations.md`
- **A failed load keeps serving the last good value** as `{ data, error }`; only
  a load with nothing to serve rejects to the Error Boundary. Don't treat `error`
  as fatal — it says the data is not current, not that the read is broken.
- **`fallback` is a read's own policy for a failed load.** It runs on every
  failure and returns what to serve: `({ lastFulfilled }) => lastFulfilled ?? EMPTY`
  for something non-essential that should never take out a subtree, or
  `({ error }) => { throw error }` where a stale value is itself wrong. What it
  returns is served, never stored — which is why this is not a `try`/`catch` in
  the loader. → `references/api-reference.md`, `references/design-notes.md`
- **No `useMutation`, no optimistic cache.** Optimistic state stays local via
  `useOptimistic` / `useActionState` next to the action. → `references/architectures.md`
- **Disable a read by passing `loader: undefined`** (gating). `promise` is then
  `undefined`; unwrap conditionally: `result.promise ? use(result.promise) : fallback`.
  → `references/api-reference.md#conditional-reads-gating`
- **An accumulated value carries its own re-read recipe.** The loader gets
  `current` — the entry's last fulfilled value — so "re-read as much as I already
  have" needs nothing in the key or in component state. Never track an infinite
  list's page depth in a ref: it desyncs from the cache the first time a component
  remounts over it, and the next invalidation silently truncates the list. Use
  `useInfiniteLane` for cursor-paginated lists; its `hasNext` is in the resolved
  value, not on the hook. → `references/common-mistakes.md`, `references/api-reference.md`

## Migrating React Query / SWR? Five traps

- **Map the model, don't port the shape.** `isLoading` → Suspense; `error` →
  the resolved value's `error` (a failure with nothing to show hits the Error
  Boundary instead, never a field); `placeholderData` for a read that may fail → `fallback`;
  `refetchInterval` → a userland poll; `onMutate` → `useOptimistic`;
  `getQueryData` → **nothing** — the store returns promises or `void`, never a
  value, so derive with `update` (the updater is handed the current value) or
  pass the value down from the component that rendered it. Don't rebuild a status
  object on top of Lane. → `references/migrating.md`
- **`queryOptions()` factories port directly** to `laneRead` — same idea, and the
  call sites map one for one (`useQuery` → `useLane`, `prefetchQuery` →
  `prefetch`, `setQueryData(opts.queryKey, v)` → `set(spec.key, v)`).
  `invalidateQueries` is the exception: it takes filters, while `invalidate` takes
  one key — a family is `invalidateAll(prefix)`. → `references/migrating.md`
- **Ephemeral UI needs its own boundary.** A modal / popover / combobox / tab panel
  that fires an initial read suspends to the nearest ancestor and *unmounts the
  surface* — put a `Suspense` inside it. → `references/common-mistakes.md`
- **Search / filter:** derive **both the key and the loader** from a
  `useDeferredValue` input so the list stays live. → `references/common-mistakes.md`
- **Polling off the render path:** don't put the key array in the effect deps;
  re-arm after each load or use a stable key id. → `references/api-reference.md#polling`
- **Forward `({ signal })` from each loader** — don't thread it through a module
  global. → `references/common-mistakes.md`

## Read next (progressive disclosure)

Load the reference that matches the task — don't read them all up front. For
exact signatures you can also read the package's bundled `dist/index.d.ts`.

| Task / question | Read |
| --- | --- |
| Avoiding common mistakes — reading promises in effects, manual loading state, hand-patched mutations | `references/common-mistakes.md` |
| Migrating React Query / SWR — the mental-model map, the transitional adapter, and the gotchas | `references/migrating.md` |
| Exact API: every export, option, return type, and behavior | `references/api-reference.md` |
| Why Lane is shaped this way; the reasoning behind each gotcha above | `references/design-notes.md` |
| Two readers of one key showing different values; why Lane skips `useSyncExternalStore` | `references/consistency.md` |
| `<Activity>` / router keep-alive: what a revealed reader shows, flash-free reveals, and the limits | `references/consistency.md#activity`, `references/integrations.md` |
| Where Lane fits: the per-key ownership rule (RSC props / published / client-owned); who owns mutations | `references/architectures.md` |
| Wiring to Next.js / React Router / TanStack / plain SPA; the back-forward (`popstate`) flash caveat | `references/integrations.md` |
| Running outside the browser — CLI (Ink), React Native, other renderers; the `eventSource` prop | `references/environments.md` |
| Conditional / deferred reads | `references/api-reference.md#conditional-reads-gating`, `#deferred-reads-render-first-swap-when-ready` |
| `staleTime` / `whenStale`, polling, focus / reconnect, `gcTime` retention | `references/api-reference.md#laneuseoptions`, `#lifecycle-behavior` |
| Keys, and scoped (prefix / predicate) operations | `references/api-reference.md#keys` |
| Colocating a read's key + loader + options (react-query's `queryOptions()`) | `references/api-reference.md#lanereadspec--key--loader-colocation` |
| Type-checked `set` / `update` from a key (react-query's `DataTag`) | `references/api-reference.md#lanekeyoft--a-key-that-knows-what-it-holds` |
| Prefetch / warm the cache on intent (hover, focus) | `references/api-reference.md#prefetch` |
| RSC / loader publication with `LaneHydration`, and reading it with `external` | `references/api-reference.md#hydration-rsc-seeding`, `#external--a-read-the-owner-publishes` |
| Writing to a published key (`set` / `update` / `invalidate`, and the `refresh` ask) | `references/api-reference.md#writing-to-a-published-key`, `references/api-reference.md#refresh--the-owner-ask` |
