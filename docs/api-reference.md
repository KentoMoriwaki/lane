# API Reference

`use-lane` is transition-native data fetching for React 19. Lane caches the
promise behind each key and re-reads it inside React transitions; React owns
loading (Suspense), errors (Error Boundaries), and optimistic UI (`useOptimistic`
/ `useActionState`).

Everything is exported from the package root:

```ts
import {
  LaneProvider,
  LaneHydration,
  useLane,
  useLanePromise,
  useLaneInstance,
  createLane,
} from "use-lane";
```

Requires React **19.2+** (`useEffectEvent`). React is a peer dependency.

## Setup

### `LaneProvider`

Provides a `Lane` instance to the tree and wires window focus / reconnect
revalidation.

```tsx
<LaneProvider lane?={Lane} focusThrottleInterval?={number}>
  {children}
</LaneProvider>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `lane` | `Lane` | a fresh `createLane()` | The Lane instance to provide. Omit to let the provider create and own one. |
| `focusThrottleInterval` | `number` | `5000` | Window `focus` and `visibilitychange` both fire on a tab switch; focus revalidations within this window are coalesced into one. Reconnect is not throttled. |

The provider listens to `window` `focus`, `document` `visibilitychange`
(visible only), and `window` `online`, and triggers `refetchOnFocus` /
`refetchOnReconnect` revalidation for subscribed entries.

### `useLaneInstance()`

Returns the current `Lane` from context. Throws if called outside a
`LaneProvider`. Use it to call mutation-convergence methods (`invalidate`,
`set`, `update`, `remove`, …) from event handlers.

```tsx
const lane = useLaneInstance();
lane.invalidate(["user", id]);
```

### `createLane(options?)`

Creates a `Lane` instance directly. Most apps never call this — `LaneProvider`
creates one for you. Use it to share a single instance across multiple providers
or to construct one outside React.

```ts
const lane = createLane({ gcTime: 5 * 60_000 });
```

#### `LaneOptions`

```ts
type LaneOptions = {
  gcTime?: number;
};
```

| Option | Default | Description |
| --- | --- | --- |
| `gcTime` | `300000` (5 min) | How long (ms) an inactive entry (no subscribers) is retained before it is garbage-collected. An instance-wide memory policy — idle-time based, unrelated to `staleTime`/freshness. `Infinity` opts out. Eviction is coalesced into a single sweep per lane, so the exact moment is approximate (it never needs to be precise). |

## Reading data

### `useLane(key, loader, options?)`

Subscribe a component to a keyed async read.

```ts
function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): LaneResult<T>;
```

- **`key`** — a structural array (`["task", id]`). See [Keys](#keys).
- **`loader`** — `({ key, signal }) => Promise<T>`, or `undefined` to gate the
  read off (see [Conditional reads](#conditional-reads-gating)). Called when the
  key has no cached promise. The `signal` aborts when the in-flight read is
  discarded (invalidation, removal, an authoritative `set` over a pending read,
  or GC).
- **`options`** — see [`LaneUseOptions`](#laneuseoptions).

Returns a [`LaneResult<T>`](#laneresultt). Unwrap `result.promise` with `use()`
inside a `Suspense` boundary — it resolves to a [`LaneRead<T>`](#lanereadt)
(`{ data, refreshError }`):

```tsx
const { promise } = useLane(["task", id], ({ signal }) => fetchTask(id, signal));
const { data: task, refreshError } = use(promise);
```

The hook keeps the current promise in React state. When the key changes during
render, it switches to the new key's promise immediately (no extra render of the
old data). When the entry is invalidated, set, updated, or removed elsewhere, the
subscribed hook re-reads through the appropriate transition.

### `useLanePromise(key, loader, options?)`

Thin wrapper that returns only the promise. Equivalent to
`useLane(...).promise`. Use it at call sites that do not need pending state or
the local `invalidate`.

```ts
const { data: task } = use(useLanePromise(["task", id], loader));
```

### `LaneResult<T>`

```ts
type LaneResult<T> = {
  promise: Promise<LaneRead<T>>;
  isTransitionPending: boolean;
  isBackgroundPending: boolean;
  invalidate: () => void;
};
```

| Field | Description |
| --- | --- |
| `promise` | The current promise for the key. Unwrap with `use(promise)` to get a [`LaneRead<T>`](#lanereadt). |
| `isTransitionPending` | `true` while an explicit invalidation (`invalidate`, `invalidateAll`, `set`, `update`) is converging through a transition. |
| `isBackgroundPending` | `true` while a background revalidation (focus / mount / polling / reconnect / subscription catch-up) is converging. |
| `invalidate` | Invalidate this exact key and re-read through a transition. Convenience for `lane.invalidate(key)`. |

### `LaneRead<T>`

What a read resolves to — `use(promise)` returns this:

```ts
type LaneRead<T> = {
  data: T;
  refreshError?: unknown;
};
```

| Field | Description |
| --- | --- |
| `data` | The value for the key. |
| `refreshError` | Present when the most recent **refresh** of an entry that already has data failed (see [Stale-on-error](#stale-on-error)): the stale `data` keeps being served and the error rides alongside it. Absent when the latest read succeeded. Initial-load failures reject `promise` instead. Carrying the error *in the resolved value* (rather than a field read live from the store during render) keeps `data` and `refreshError` consistent under concurrent rendering and avoids a render-purity violation. |

### `LaneGatedResult<T>`

What `useLane` / `useLanePromise` return when the loader may be `undefined` —
`promise` widens to `Promise<T> | undefined`:

```ts
type LaneGatedResult<T> = Omit<LaneResult<T>, "promise"> & {
  promise: Promise<LaneRead<T>> | undefined;
};
```

A statically-present loader keeps the non-nullable `LaneResult<T>`; a
possibly-`undefined` loader selects this gated shape. See
[Conditional reads](#conditional-reads-gating).

### Conditional reads (gating)

Pass `undefined` as the loader to gate a read off. While disabled nothing is
fetched, no subscription is created, and no entry is stored — `result.promise`
is `undefined`. Because Lane only loads external data, an absent loader has no
other meaning, so it is the single, unambiguous disable signal (there is no
`enabled` option).

```tsx
const detail = useLane(
  ["component", componentId],
  componentId
    ? ({ signal }) => fetchComponent(componentId, { signal })
    : undefined,
);
const value = detail.promise ? use(detail.promise).data : null;
```

Gating through the loader keeps two things honest:

- **The loaded type is unaffected.** The off-state lives on the `promise:
  undefined` axis, so `Awaited<promise>` stays `T` — the fallback type is chosen
  at the unwrap site, never mixed into the loaded value.
- **No assertions.** Branch the loader on the same value it dereferences
  (`componentId ? … : undefined`); that value is narrowed to non-null inside the
  closure.

The key may carry not-yet-ready segments (`null` / `undefined`) while disabled —
nothing is stored, so no placeholder key is needed. Segments must still be
serializable, since the key is serialized for identity tracking even while
disabled.

### Deferred reads (render first, swap when ready)

Sometimes you want a read's data but don't want its load to gate the surrounding
UI: render the rest of the screen now, let one region fill in when the load
resolves, and never flash a Suspense fallback.

The lever is that **`use()` may be called conditionally** — unlike `useState` /
`useEffect` it resolves by the promise you hand it, not by call order — so
*owning* a read and *suspending* on it become separate acts. Call `useLane`
unconditionally (the load starts during render and the promise is cached) and
gate only the `use()`. The fetch runs immediately; just the reveal waits,
switched on inside a transition so the suspend keeps the committed UI instead of
revealing the fallback.

```tsx
import { use, useEffect, useState, useTransition } from "react";
import { useLane } from "use-lane";

function ComponentGraph({ selectedId }: { selectedId: string }) {
  const [reveal, setReveal] = useState(false);
  const [isPending, startTransition] = useTransition();

  // After the first commit, switch the reveal on inside a transition.
  useEffect(() => {
    startTransition(() => setReveal(true));
  }, []);

  // Loader always set → the fetch starts on the first render, not when revealed.
  const { promise } = useLane(["component-graph", selectedId], ({ signal }) =>
    fetchComponentGraph(selectedId, signal),
  );

  // Not revealed yet: render the placeholder, never a fallback. `use` is only
  // reached when `reveal` is true, so the first render never suspends.
  if (!reveal) return <GraphSkeleton busy={isPending} />;

  // Now `use` suspends — but the transition holds the committed placeholder and
  // swaps in the graph when the read resolves. The fallback never shows.
  const { data } = use(promise);
  return <Graph data={data} />;
}
```

Why each piece matters:

- **Loader always set.** `useLane` runs the loader during render and caches the
  promise, so the fetch is in flight before the transition — the earliest start,
  and the entry is subscribed (focus / poll / invalidation live) from mount.
- **Reveal gated, not the loader.** `if (!reveal)` returns before `use`, so the
  first render commits the placeholder without suspending. That committed output
  is the already-revealed content React keeps while the transition is pending.
- **Flip inside a transition.** A plain `setReveal(true)` would suspend as a
  non-transition update, and React would replace the placeholder with the nearest
  Suspense fallback. The transition turns "show the fallback" into "keep the
  current UI until ready." `isPending` is `true` meanwhile — drive a loading
  affordance off it.

Multiple deferred reads:

Each loader is set unconditionally, so **every read's fetch starts in parallel on
mount** — you don't orchestrate it. How they *reveal* is set by how you gate the
`use()` calls:

- **Gate them together** (one `reveal`, one transition) → they reveal together,
  when the last resolves. Right when the output needs all of them.
- **Stagger the gates** (reveal the fast one, switch the next on once it has
  committed) → fast data shows first. The fetches already started on mount, so the
  slow one still lands at its own latency, not after the fast one.

The staggering is necessary because **transitions that suspend at the same time
commit together** (the slower one gates the pair): revealing together is
automatic, but fast-first needs the staggered gate. Data you don't integrate at
all is simpler read in its own `<Suspense>` boundary, which reveals independently
with a fallback.

Caveats:

- **Keep a `<Suspense>` boundary above** as the backstop. The transition holds
  the committed UI; the boundary is still the safety net.
- **This defers the reveal, not the key change.** When `selectedId` changes,
  `useLane` switches to the new key's promise during an ordinary update, which
  suspends and reveals the fallback again. To keep those swaps flash-free, wrap
  the state change that drives the key in a transition too (see
  [Transitions](./integrations.md#transitions-and-the-backforward-caveat)).
- `use(promise)` resolves to a [`LaneRead<T>`](#lanereadt) — read `.data` (and
  `.refreshError` if present).
- This **always fetches**. Deferring the reveal is for data you *will* need but
  want off the critical paint. When a read may genuinely never be needed, gate
  the *loader* instead (`loader: undefined`) — see
  [Conditional reads](#conditional-reads-gating).

### `prefetch`

Warm a key before any reader mounts: start its load and cache the promise,
without subscribing or suspending. The next `useLane` / `useLanePromise` for the
same key adopts the in-flight or settled promise instead of starting its own
fetch. It is the complement to
[deferred reads](#deferred-reads-render-first-swap-when-ready) — deferred reads
start the fetch early *inside* a rendering component; `prefetch` starts it
*before* the component exists.

```ts
prefetch<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LanePrefetchOptions,
): Promise<LaneRead<T>>;

type LanePrefetchOptions = Pick<LaneUseOptions, "retry" | "retryDelay">;
```

`prefetch` is a method on the
[`Lane` instance](#mutation-convergence--the-lane-instance)
(`useLaneInstance().prefetch(...)`). The canonical use is intent-driven warming —
hover (and `focus`, for keyboard users) over a link to warm the destination's
data before navigation:

```tsx
const lane = useLaneInstance();
const warm = () =>
  lane.prefetch(["component-graph", id], ({ signal }) =>
    fetchComponentGraph(id, signal),
  );

<Link href={`/component/${id}`} onMouseEnter={warm} onFocus={warm} />;
```

- **Deduped.** A repeat `prefetch` of the same key (a re-fired hover) reuses the
  cached promise — the loader runs once. `prefetch` always reads with
  `"revalidate"` semantics, so it never discards an in-flight or settled cache.
- **Not subscribed.** A prefetched entry has no reader, so it does not poll,
  revalidate on focus, or anchor against GC. Like any read it arms no timer: if
  no reader adopts it, it is an orphan reclaimed by the lane's sweep (within
  `gcTime`); if a reader mounts first, the entry becomes live and is kept.
- **Freshness is the reader's call.** `prefetch` only warms; `staleTime` /
  `whenStale` are decided by the eventual `useLane`, so `LanePrefetchOptions`
  exposes only `retry` / `retryDelay`.

The returned `Promise<LaneRead<T>>` is the warmed promise — usually ignored, but
available to `await` if you want to sequence work after the warm-up. A rejected
prefetch that nobody consumes does not surface as an unhandled rejection.

### `LaneUseOptions`

```ts
type LaneUseOptions = {
  staleTime?: number;
  whenStale?: "revalidate" | "refetch";
  retry?: number;
  retryDelay?: (attempt: number, error: unknown) => number;
  refetchInterval?: number;
  refetchOnFocus?: boolean | "always";
  refetchOnMount?: boolean | "always";
  refetchOnReconnect?: boolean | "always";
};
```

> `gcTime` is **not** a per-read option — it is an instance-wide policy passed to
> [`createLane({ gcTime })`](#laneoptions).

| Option | Default | Description |
| --- | --- | --- |
| `staleTime` | `0` | How long (ms) a fulfilled value is considered fresh. Once stale, a read's behavior is decided by `whenStale`, and the entry becomes eligible for `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` reloads. |
| `whenStale` | `"revalidate"` | What a read does when the cached value is stale (older than `staleTime`). `"revalidate"` reuses the cached value and refreshes it in the background — the reader keeps showing it and converges through a transition. `"refetch"` discards the stale value (or a prior error) and suspends on a fresh read, but never discards an in-flight read or a value a live subscriber is showing, so it only forces a fresh load on an otherwise idle remount. |
| `retry` | `0` | Number of automatic retries for a failed load. Aborts stop the retry loop. |
| `retryDelay` | exponential backoff, `min(1000 · 2^attempt, 30000)` | Delay (ms) before retry `attempt`. |
| `refetchInterval` | — | Poll the entry every N ms. The smallest interval across subscribers is used; ticks are settled-only so pending reads dedupe. |
| `refetchOnFocus` | `false` | `true` reloads stale entries on window focus; `"always"` reloads settled entries regardless of `staleTime`. |
| `refetchOnMount` | `false` | `true` reloads stale entries when a reader mounts; `"always"` reloads settled entries on mount. |
| `refetchOnReconnect` | `false` | Same as `refetchOnFocus`, driven by the browser `online` event. |

## Keys

A `LaneKey` is a structural array. Keys are serialized to a canonical id for
exact lookup, and compared structurally for scoped matching.

```ts
type LaneKey = readonly unknown[];
```

Supported segment types: `string`, `number`, `boolean`, `bigint`, `null`,
`undefined`, `Date` (serialized by timestamp; invalid dates stay stable),
arrays, and plain objects (keys are sorted, so property order does not matter).
Other values (`Map`, `Set`, functions, class instances) throw.

```ts
["tasks", { scope: "all", q: "" }]; // object property order is normalized
["task", "t_123"];
["report", new Date("2026-01-01")];
```

### Scopes

A `LaneScope` selects a *family* of existing entries for the `*All` methods,
either by key prefix or by predicate.

```ts
type LaneScope =
  | LaneKey
  | ((entry: { key: LaneKey; keyId: string }) => boolean);
```

```ts
lane.invalidateAll(["tasks"]); // prefix: every ["tasks", …] entry
lane.invalidateAll((entry) => entry.key[0] === "tasks"); // predicate
```

Scoped operations only touch entries that already exist; you never have to
enumerate every key that *could* exist.

## Mutation convergence — the `Lane` instance

Get the instance from `useLaneInstance()` (or `createLane()`). Most methods
converge mutations; `prefetch` warms a read ahead of a reader and is covered
under [Reading data](#prefetch).

```ts
type Lane = {
  prefetch<T>(key: LaneKey, loader: LaneLoader<T>, options?: LanePrefetchOptions): Promise<LaneRead<T>>;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: T | Promise<T>): Promise<LaneRead<T>>;
  update<T>(key: LaneKey, updater: LaneUpdater<T>): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
};
```

### `invalidate` / `invalidateAll`

Clear the cached promise(s) and notify subscribers to re-read with their current
loader. This is the **primary** convergence tool: mutate the source, invalidate
the read, render the next promise.

```ts
lane.invalidate(["task", id]);
lane.invalidateAll(["tasks"]);
```

`LaneInvalidateOptions` narrows *which* entries actually invalidate:

```ts
type LaneInvalidateOptions = {
  onlyIf?: "stale" | "settled";
  staleTime?: number;
};
```

- omit `onlyIf` → always invalidate.
- `"stale"` → only fulfilled entries older than `staleTime`.
- `"settled"` → only entries with a settled promise (skips in-flight reads).

### `set`

Publish an authoritative value (or promise) to an exact key, then notify
subscribers. Use it for server-confirmed data already in hand — e.g. a create or
update response — so consumers do not re-fetch. Aborts any in-flight read for the
key. Returns the published promise.

```ts
const saved = await updateTask(id, input);
lane.set(["task", saved.id], saved);
```

`set` is **not** an optimistic-update mechanism. Optimistic state belongs in
component-local `useOptimistic`.

### `update` / `updateAll`

Derive the next value from the current one. Fulfilled entries update
immediately; pending entries chain the updater onto the in-flight promise;
rejected or missing entries are left unchanged (`update` returns `undefined`).
`update` adopts the in-flight result, so it does **not** abort the read.

```ts
type LaneUpdater<T> = (current: T, entry: LaneEntryInfo) => T | Promise<T>;

lane.update<Task>(["task", id], (task) => ({ ...task, done: true }));
lane.updateAll<Task[]>(["tasks"], (list) => list.filter((t) => t.id !== id));
```

### `remove` / `removeAll`

Drop entries that no longer belong in client state — sign out, team switch, a
deleted selected entity. Removal is **urgent**: subscribed readers stop
rendering the removed promise immediately (no transition).

```ts
lane.remove(["task", id]);
lane.removeAll(() => true); // clear everything, e.g. on sign out
```

## Hydration (RSC seeding)

### `LaneHydration`

Applies server-loaded snapshots as authoritative seed values, so the first
client render reads fulfilled promises instead of fetching. Re-applying a new
snapshots instance on navigation **overwrites** the matching entries and notifies
mounted readers, so they converge to fresh server data.

```tsx
<LaneProvider>
  <LaneHydration snapshots={snapshots}>{children}</LaneHydration>
</LaneProvider>
```

| Prop | Type | Description |
| --- | --- | --- |
| `snapshots` | `LaneHydrationSnapshots` | Entries to seed. |
| `children` | `React.ReactNode` | Rendered after the snapshots are applied. |

```ts
type LaneSnapshot<T = unknown> = { key: LaneKey; data: T };
type LaneHydrationSnapshots = { entries: readonly LaneSnapshot[] };
```

A given snapshots instance is applied to a given lane **at most once**, so
repeated provider renders and Strict Mode do not re-seed. Build the snapshots on
the server from the same keys your hooks use:

```ts
const snapshots: LaneHydrationSnapshots = {
  entries: [
    { key: ["current-user"], data: currentUser },
    { key: ["tasks", filters], data: tasks },
  ],
};
```

Hydration is for initial seeding and navigation, not post-mutation patching.
Once the client owns the read, converge with `invalidate` / `set` / `update`.

## Lifecycle behavior

- **Stale-on-error.** <a id="stale-on-error"></a> When an entry already has a
  fulfilled value and its next read rejects (after invalidation, focus refetch,
  polling, or a `set` of a rejecting promise), the cached promise keeps resolving
  with the **last fulfilled value** and the failure surfaces as `refreshError`.
  Freshness keeps the original fulfillment time, so staleness policies still
  treat the data as old and retry. Only an **initial** load (no previous value)
  rejects the promise and reaches the Error Boundary.
- **Stale reads.** `staleTime` sets how long a value stays fresh; on a stale
  read, `whenStale` decides what happens. `"revalidate"` (default) keeps showing
  the cached value and refreshes in the background. `"refetch"` discards an idle
  stale value (or a prior error) and suspends on a fresh load — never discarding
  an in-flight read or a value a live subscriber is showing. This is orthogonal to `refetchOnMount`
  / `refetchOnFocus` / `refetchOnReconnect`, which decide *when* a background
  revalidation is triggered, not what a read shows.
- **Abort.** Loaders receive an `AbortSignal` that fires when the read is
  discarded by invalidation, removal, an authoritative `set` over a pending read,
  or GC.
- **Retry.** `retry` / `retryDelay` retry failed loads (default: none;
  exponential backoff capped at 30s when enabled). Aborts stop the loop.
- **Structural sharing.** When a reload resolves with data deeply equal to the
  previous value, previous references are reused so memoized consumers do not
  re-render.
- **Polling.** `refetchInterval` keeps one timer per entry, using the smallest
  interval across subscribers, ticking through settled-only background
  invalidation.
- **Focus / reconnect.** The provider coalesces `focus` + `visibilitychange`
  into one revalidation per `focusThrottleInterval` (default 5s); `online` drives
  reconnect revalidation (not throttled).
- **Garbage collection.** An inactive entry (no subscribers) is retained for the
  lane's `gcTime` (`createLane({ gcTime })`, default 5 min; `Infinity` opts out)
  and then collected. Collection is a single coalesced sweep per lane — armed
  when an entry loses its last subscriber, so timing is approximate. Because the
  sweep is lane-wide, it also reclaims orphans (entries from renders that never
  committed) on whatever cycle a later unsubscribe triggers.

## Type exports

`Lane`, `LaneEntryInfo`, `LaneGatedResult`, `LaneHydrationSnapshots`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneOptions`, `LanePrefetchOptions`, `LaneRead`,
`LaneRefetchOnFocus`, `LaneRefetchOnMount`, `LaneRefetchOnReconnect`,
`LaneResult`, `LaneRetryDelay`,
`LaneScope`, `LaneSnapshot`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`, `LaneWhenStale`.

## See also

- [Supported architectures](./architectures.md) — RSC-first and RSC-seeded client ownership.
- [Design notes](./design-notes.md) — the rationale behind these choices.
