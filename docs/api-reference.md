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
  useLanesAll,
  useLaneInstance,
  createLane,
} from "use-lane";
```

Requires React **19.2+** (`useEffectEvent`). React is a peer dependency.

## Setup

### `LaneProvider`

Provides a `Lane` instance to the tree and wires focus / reconnect revalidation
from a pluggable event source.

```tsx
<LaneProvider lane?={Lane} focusThrottleInterval?={number} eventSource?={LaneEventSource}>
  {children}
</LaneProvider>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `lane` | `Lane` | a fresh `createLane()` | The Lane instance to provide. Omit to let the provider create and own one. |
| `focusThrottleInterval` | `number` | `5000` | Focus and `visibilitychange` both fire on a tab switch; focus revalidations within this window are coalesced into one. Reconnect is not throttled. |
| `eventSource` | `LaneEventSource` | `domEventSource` | Where focus / reconnect signals originate. Defaults to browser DOM events. Pass `noopEventSource` (CLI), `createReactNativeEventSource(...)` (React Native), or your own — see [Event sources](#event-sources) and [Environments](./environments.md). Use a stable reference. |

With the default `domEventSource`, the provider listens to `window` `focus`,
`document` `visibilitychange` (visible only), and `window` `online`, and triggers
`refetchOnFocus` / `refetchOnReconnect` revalidation for subscribed entries. The
source is feature-detected, so importing it off the web (Node, Ink, React Native)
safely no-ops instead of throwing.

### Event sources

`eventSource` decides where "the app came to the foreground" and "the network
reconnected" signals come from — the only environment-coupled input Lane has. The
provider owns the policy (throttling, fanning out to readers); a source owns only
the signal. Three are shipped, all stable references safe to pass directly:

| Export | Use |
| --- | --- |
| `domEventSource` | **Default.** Browser `focus` / `visibilitychange` / `online`, feature-detected (no-ops off the web). |
| `noopEventSource` | Emits nothing — opt out of focus / reconnect revalidation (e.g. a CLI). |
| `createReactNativeEventSource({ AppState, netInfo? })` | React Native: focus from `AppState` returning to the foreground, reconnect from NetInfo (optional). You pass the native modules in, so Lane never imports `react-native`. |

```ts
type LaneEventSource = (handlers: {
  onFocus: () => void;
  onReconnect: () => void;
}) => (() => void) | void;
```

Write your own for any other renderer: call `onFocus` / `onReconnect` when the
environment signals them and return a cleanup. Pass a **stable reference** — it is
a provider effect dependency (the shipped sources are module constants). See
[Environments](./environments.md) for full CLI (Ink) and React Native recipes.

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
| `gcTime` | `300000` (5 min) | How long (ms) an inactive entry (no subscribers) is retained before it is garbage-collected. An instance-wide memory policy — idle-time based, unrelated to `staleTime`/freshness. `Infinity` opts out. Eviction is coalesced into a single sweep per lane, so the exact moment is approximate (it never needs to be precise). A reader that has not committed yet counts as inactive from the moment it starts its first load — it suspends before it can subscribe — so `gcTime` doubles as the grace window for that first load: if it runs longer than `gcTime` and a sweep fires, the in-flight read is aborted (its `signal` fires) and refetched on the retry. Keep `gcTime` comfortably longer than your slowest request (including retries); avoid `0` for reads that suspend for a while. |

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
  invalidate: (options?: LaneInvalidateOptions) => void;
};
```

| Field | Description |
| --- | --- |
| `promise` | The current promise for the key. Unwrap with `use(promise)` to get a [`LaneRead<T>`](#lanereadt). |
| `isTransitionPending` | `true` while an explicit invalidation (`invalidate`, `invalidateAll`, `set`, `update`) is converging through a transition. |
| `isBackgroundPending` | `true` while a background revalidation (focus / mount / reconnect / a `background: true` invalidation / subscription catch-up) is converging. |
| `invalidate` | Invalidate this exact key and re-read. Convenience for `lane.invalidate(key, options?)`; accepts the same `LaneInvalidateOptions` (e.g. `{ background: true, onlyIf: "settled" }` for a self-scheduled poll). Defaults to an explicit transition. |

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

### `useLanesAll(reads, options?)` — a batch read

Read a **dynamic-length** set of `[key, loader]` pairs with one hook and get back
a single stable `Promise.all` of their values. `useLane` calls a fixed set of
hooks, so it can't be called in a loop over a list whose length varies;
`useLanesAll` orchestrates all the reads internally over the same core primitives.

```ts
function useLanesAll<T>(
  reads: readonly (readonly [LaneKey, LaneLoader<T>])[],
  options?: LaneUseOptions, // shared by every read
): Promise<LaneRead<T>[]>;
```

```tsx
const promise = useLanesAll(
  ids.map((id) => [["task", id], ({ signal }) => fetchTask(id, signal)]),
  { staleTime: 60_000 },
);

// Suspends until all resolve (they load in parallel); a rejecting *initial* load
// throws to the Error Boundary.
const tasks = use(promise).map((read) => read.data);
```

Each `[key, loader]` is its own keyed read — independently cached, deduped,
subscribed (focus / reconnect / `refetchOnMount`), and invalidatable,
exactly as if you had called `useLane` for each. Three deliberate simplifications
versus a per-item API:

- **The loader is required.** To leave a read out, omit it from the array — there
  is no per-item gating (that is what `loader: undefined` does on a single
  `useLane`).
- **`options` are shared** by every read in the batch (changing them
  re-subscribes all, matching `useLane`'s option reactivity).
- **The return is just the promise** — one stable, `use()`-able `Promise.all`,
  not an array of per-item handles.

**Why a single aggregate, not an array of promises.** Mapping `use()` over a
per-item array is exactly what a child-per-row already does better (each row
keeps its own boundary), so a parent gains nothing by holding the array. The one
thing a parent *can't* easily build itself is a **stable** `Promise.all`:
`use(Promise.all(...))` inline gets a fresh promise every render (re-suspends) and
dead-loops on a rejection (a suspended component never commits, so a
per-render/ref memo keeps resetting). `useLanesAll` owns that identity for you and
swaps it inside a transition when a member changes — so a background refresh keeps
the previous values on screen (you just don't get a pending flag).

There is deliberately **no `combine` option.** Combine in render from
`use(promise)`. (react-query's `combine` is incremental over synchronous
per-query *status*; Lane is suspense-based, so reading the values means
suspending — an aggregate is all-or-nothing by nature. A partial combine would
need status fields Lane intentionally does not have.)

Notes:

- **Each member behaves exactly like `useLane`** — transitions, stale-on-error,
  focus / reconnect, `refetchOnMount`, GC, and reacting to (shared) option changes
  (`staleTime` / `refetchOnFocus` / `refetchOnReconnect` re-subscribe; `retry` /
  `whenStale` apply on the next read). A batch is N `useLane`s feeding one
  `Promise.all`.
- **Adding a read** subscribes and loads just that read; the reads already on
  screen are not refetched. **Removing one** unsubscribes it.
- **Invalidation** is by key: `lane.invalidate(key)` for one, or
  `lane.invalidateAll(scope)` for a family.
- **Duplicate keys** in one call share a single entry (like two `useLane` calls
  with the same key).

For rendering N *independent* rows (not aggregating), don't use `useLanesAll` at
all — render a child component per row and call `useLane` inside each, so every
row keeps its own Suspense boundary and pending state.

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
  and the entry is subscribed (focus / reconnect / invalidation live) from mount.
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
- **Not subscribed.** A prefetched entry has no reader, so it does not revalidate
  on focus, or anchor against GC. If no reader adopts it, it is an orphan
  reclaimed by the lane's sweep (within `gcTime`); if a reader mounts first, the
  entry becomes live and is kept.
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
  background?: boolean;
};
```

- omit `onlyIf` → always invalidate.
- `"stale"` → only fulfilled entries older than `staleTime`.
- `"settled"` → only entries with a settled promise (skips in-flight reads).
- `background: true` → converge through the **background** transition
  (`isBackgroundPending`) instead of the default explicit one
  (`isTransitionPending`). Use it for automatic refreshes so they don't read as a
  user-driven invalidation — see [Polling](#polling).

### Polling

Lane has no `refetchInterval` option: polling is just a self-scheduled
invalidation, written with primitives (the same stance as mutations). Because a
component only commits *after* `use(promise)` resolves, an effect that reschedules
after each load never fires mid-flight:

```tsx
function Polled({ id }: { id: string }) {
  const { promise } = useLane(["task", id], ({ signal }) => fetchTask(id, signal));
  const lane = useLaneInstance();
  const task = use(promise).data;

  useEffect(() => {
    // Re-armed after each successful load, so it never aborts an in-flight read.
    const timer = setTimeout(
      () => lane.invalidate(["task", id], { background: true }),
      5_000,
    );
    return () => clearTimeout(timer);
  }, [promise, id, lane]);

  return <TaskCard task={task} />;
}
```

- **`background: true`** keeps the refresh off `isTransitionPending` (it surfaces
  as `isBackgroundPending`), so an automatic poll doesn't read like a user action.
- Depending on `[promise]` makes it a **poll-after-response** loop (a fixed gap
  after each load). For a fixed **wall-clock** interval, use `setInterval` plus
  `{ onlyIf: "settled" }` so a tick during an in-flight read is skipped instead of
  aborting it:
  ```tsx
  setInterval(() => lane.invalidate(key, { background: true, onlyIf: "settled" }), 5_000);
  ```
- **Keep the schedule off the render path.** Don't put the key *array* in the
  effect's dependency list — it is a fresh reference every render, so the effect
  tears down and recreates the timer on each render, and if the component
  re-renders faster than the interval it never fires. Depend on a stable key id
  (e.g. a serialized key) and read the latest key from a ref, or prefer the
  `setTimeout` form above — it re-arms after each load, so it is naturally
  independent of render frequency.
- **A reader can poll itself.** The `invalidate` returned from `useLane` accepts
  the same options and is bound to that read's key, so a per-reader poll needs no
  external key, and its identity is stable across renders — depend on it directly
  and the render-path caveat above falls away:
  ```tsx
  const { promise, invalidate } = useLane(["task", id], ({ signal }) => fetchTask(id, signal));
  const task = use(promise).data;
  useEffect(() => {
    const timer = setInterval(() => invalidate({ background: true, onlyIf: "settled" }), 5_000);
    return () => clearInterval(timer);
  }, [invalidate]);
  ```

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
  or a `set` of a rejecting promise), the cached promise keeps resolving
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
- **Polling.** Not a built-in — schedule your own timer and call
  `invalidate(key, { background: true })`. See [Polling](#polling).
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

`Lane`, `LaneEntryInfo`, `LaneEventSource`, `LaneGatedResult`, `LaneHydrationSnapshots`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneOptions`,
`LanePrefetchOptions`, `LaneRead`, `LaneRefetchOnFocus`, `LaneRefetchOnMount`, `LaneRefetchOnReconnect`,
`LaneResult`, `LaneRetryDelay`, `LaneRevalidateHandlers`,
`LaneScope`, `LaneSnapshot`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`, `LaneWhenStale`,
`ReactNativeAppState`, `ReactNativeEventSourceOptions`, `ReactNativeNetInfo`.

Runtime exports beyond the hooks and `createLane`: `domEventSource`,
`noopEventSource`, `createReactNativeEventSource` (see [Event sources](#event-sources)).

## See also

- [Common mistakes](./common-mistakes.md) — anti-patterns and the use-lane way to write them.
- [Supported architectures](./architectures.md) — RSC-first and RSC-seeded client ownership.
- [Design notes](./design-notes.md) — the rationale behind these choices.
