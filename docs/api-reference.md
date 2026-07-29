# API Reference

`use-lane` is promise-first, transition-native data fetching for React 19. Lane
keeps each keyed read's promise in React state and replaces it through React
transitions; React owns loading (Suspense), errors (Error Boundaries), pending,
and optimistic UI (`useOptimistic` / `useActionState`).

Everything is exported from the package root:

```ts
import {
  LaneProvider,
  LaneHydration,
  useLane,
  useLanePromise,
  useLanesAll,
  useInfiniteLane,
  useLaneInstance,
  laneRead,
  infiniteLaneRead,
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
function useLane<T, C = T>(
  key: LaneKey,
  loader: LaneLoader<T, C>,
  options?: LaneUseOptions,
): LaneResult<T>;

// The same read, described in one value — see `laneRead` below.
function useLane<T, C = T>(spec: LaneReadSpec<T, C>): LaneResult<T>;
```

- **`key`** — a structural array (`["task", id]`). See [Keys](#keys).
- **`loader`** — `({ key, signal, current }) => Promise<T>`, or `undefined` to
  gate the read off (see [Conditional reads](#conditional-reads-gating)). Called
  when the key has no cached promise. The `signal` aborts when the in-flight read
  is discarded (invalidation, removal, an authoritative `set` over a pending
  read, or GC).
- **`options`** — see [`LaneUseOptions`](#laneuseoptions).

**`current`** is the entry's last fulfilled value, or `undefined` on a first
load — snapshotted when the read is created, so every retry of that read sees
the same value. It lets a loader re-read *as much as it already had* rather than
only what the key describes: the accumulated pages of a list, a cursor to resume
from, a revision to send as `If-None-Match`. It survives invalidation, which
clears the cached promise and not the last fulfilled value, and is `undefined`
again once the entry itself is gone — [removed](#remove--removeall), collected,
or invalidated while nothing was subscribed to hold it — so a loader must always
define what a first load means. It is not a way to skip work: the value is the
previous read's, and returning it unchanged strands the entry on stale data.

Its type is the read's **second type parameter, defaulting to the loaded type**,
so annotating the read is what types it:

```tsx
const { promise } = useLane<Feed>(["feed"], async ({ current, signal }) => {
  const since = current?.cursor ?? null; // current: Feed | undefined
  return fetchFeedSince(since, signal);
});
```

Reading `current` without that annotation is a type error asking for one, never a
silent `any`. The loaded type stays in the return position, so a loader that
ignores `current` keeps inferring exactly as before — `useLane(["task", id], ({
signal }) => fetchTask(id, signal))` still yields `LaneResult<Task>` with no type
argument. Give `C` explicitly only for a loader whose `current` is deliberately
narrower or wider than its result. [Why it is shaped this
way](./design-notes.md#a-loaders-input-includes-what-it-already-produced).

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

### `laneRead(spec)` — key + loader colocation

Describe a read once — its key, its loader, and the options it is read with —
and pass that one value wherever the read is named. It is Lane's equivalent of
react-query's `queryOptions()`.

```ts
function laneRead<T, C = T>(spec: LaneReadSpec<T, C>): LaneReadSpec<T, C>;

type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneLoader<T, C>;
};
```

```ts
// lanes/tasks.ts — the whole read, in one place.
export const taskLanes = {
  detail: (id: string) =>
    laneRead({
      key: ["task", id],
      loader: ({ signal }) => fetchTask(id, signal),
      staleTime: 60_000,
    }),
  list: (filters: TaskFilters) =>
    laneRead({
      key: ["tasks", filters],
      loader: ({ signal }) => fetchTasks(filters, signal),
      refetchOnFocus: true,
    }),
};
```

```tsx
const { promise, isTransitionPending } = useLane(taskLanes.detail(id));
const { data: task } = use(promise);
```

Every consumer accepts a spec wherever it accepts a key:

| Consumer | With a spec |
| --- | --- |
| [`useLane`](#uselanekey-loader-options) | `useLane(taskLanes.detail(id))` |
| [`useLanePromise`](#uselanepromisekey-loader-options) | `use(useLanePromise(taskLanes.detail(id)))` |
| [`useLanesAll`](#uselanesallreads-options--a-batch-read) | `useLanesAll(ids.map(taskLanes.detail))` |
| [`useInfiniteLane`](#useinfinitelanekey-options-readoptions--a-cursor-paginated-list) | `useInfiniteLane(feedLanes.list(filters))` — built with [`infiniteLaneRead`](#infinitelanereadspec) |
| [`prefetch`](#prefetch) | `lane.prefetch(taskLanes.detail(id))` |
| [`invalidate`](#invalidate--invalidateall) / [`remove`](#remove--removeall) / [`cancel`](#cancel) | `lane.invalidate(taskLanes.detail(id))` |
| [`set`](#set) / [`update`](#update--updateall) | `lane.set(taskLanes.detail(task.id), task)` |

**Why colocate.** A key factory in one module and a fetcher in another are two
halves of one fact, and no type checks that a call site pairs them correctly —
`useLane(taskKeys.detail(id), () => fetchTasks(filters))` compiles and is wrong.
Options drift the same way, and more quietly: they live at the call site while
the key does not, so one component reads a key with `staleTime: 60_000` and the
next reads the same key with none.

**What the factory buys you.** At runtime it returns its argument — the value is
the point, not the call. What it adds is types:

- **`T` is inferred at the definition** from the loader's return type, so every
  consumer reads that type back instead of re-inferring it. This is what makes
  the *write* side checked: `lane.set(spec, value)` and `lane.update(spec, updater)`
  know what the read holds, where a bare key carries no type and checks nothing.
- **The shape is checked where it is written**, so a mistyped option is an error
  at the definition rather than a silently ignored property at three call sites.

`C` — the type of [`current`](#uselanekey-loader-options) — still defaults to `T`
and is still given explicitly (`laneRead<Feed, Cursor>({ … })`) for a loader whose
`current` is deliberately narrower or wider than its result.

**Gating works unchanged.** A spec whose `loader` is `undefined` is a
[gated read](#conditional-reads-gating): `LaneGatedReadSpec<T, C>`, and
`useLane` hands back a [`LaneGatedResult<T>`](#lanegatedresultt).

```tsx
const spec = laneRead({
  key: ["component", componentId],
  loader: componentId
    ? ({ signal }) => fetchComponent(componentId, { signal })
    : undefined,
});
const { promise } = useLane(spec);
const value = promise ? use(promise).data : null;
```

**Overriding at a call site is a spread**, as with `queryOptions()` — the spec is
a plain object, so nothing special is needed and the result stays typed:

```tsx
const { promise } = useLane({ ...taskLanes.detail(id), refetchOnFocus: true });
```

**No registry, no identity rules.** A spec is a plain object; two calls to the
same factory produce two objects with equal keys, and Lane addresses entries by
serialized key. Build them per render, in an event handler, or on the server —
nothing needs memoizing for identity. (`useLanesAll` still wants a
[stable `reads` array](#uselanesallreads-options--a-batch-read), for the same
reason it always did.)

**Scoped operations still take a scope.** `invalidateAll` / `updateAll` /
`removeAll` deliberately do not accept a spec: a spec describes *one* read, while
a scope selects a family of existing entries — `lane.invalidateAll(["tasks"])`.
See [Key matching](./design-notes.md#key-matching-exact-vs-scoped).

> `laneRead` *describes* a read; [`LaneRead<T>`](#lanereadt) is what one
> *resolves to*.

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

// Or as specs, which carry their own options (see `laneRead`).
function useLanesAll<T, C = T>(
  reads: readonly LaneReadSpec<T, C>[],
  options?: LaneUseOptions, // the fallback for what a spec does not set
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

A batch is usually derived from a list, which is where
[`laneRead`](#lanereadspec--key--loader-colocation) fits best — the members are
the same read applied to different inputs:

```tsx
const reads = useMemo(() => ids.map(taskLanes.detail), [ids]);
const tasks = use(useLanesAll(reads)).map((read) => read.data);
```

Each `[key, loader]` (or spec) is its own keyed read — independently cached,
deduped, subscribed (focus / reconnect / `refetchOnMount`), and invalidatable,
exactly as if you had called `useLane` for each. Three deliberate simplifications
versus a per-item API:

- **The loader is required.** To leave a read out, omit it from the array — there
  is no per-item gating (that is what `loader: undefined` does on a single
  `useLane`).
- **`options` are shared** by every read in the batch (changing them
  re-subscribes all, matching `useLane`'s option reactivity). A **spec carries
  its own**, which win where it sets them: a member reads exactly the way it is
  defined, and inherits the rest from the batch.
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

### `useInfiniteLane(key, options, readOptions?)` — a cursor-paginated list

Read an infinite list as **one key holding the whole accumulated list**, with the
page depth read back out of the cached value rather than kept in the key or in
component state. It is `useLane` plus a loader that walks the cursor chain as
deep as [`current`](#uselanekey-loader-options) already is — no core machinery,
nothing an ordinary read does not already do.

```ts
function useInfiniteLane<P, C>(
  key: LaneKey,
  options: {
    initialCursor: C;
    fetchPage: (cursor: C, context: { signal?: AbortSignal }) => Promise<P>;
    nextCursor: (page: P, cursor: C) => C | null;
  },
  readOptions?: LaneUseOptions,
): {
  promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  loadMore: () => Promise<LaneRead<InfiniteLaneValue<P, C>>> | undefined;
  isTransitionPending: boolean;
  isBackgroundPending: boolean;
  invalidate: (options?: LaneInvalidateOptions) => void;
};
```

#### `infiniteLaneRead(spec)`

The colocated form, `laneRead` for a list: the key, the pagination, and the read
options in one value.

```ts
function infiniteLaneRead<P, C>(
  spec: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneReadSpec<P, C>;

type InfiniteLaneReadSpec<P, C> = LaneUseOptions &
  InfiniteLaneOptions<P, C> & { key: LaneKey };
```

```ts
export const feedLanes = {
  list: (filters: Filters) =>
    infiniteLaneRead({
      key: ["feed", filters],
      initialCursor: null as string | null,
      fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
      nextCursor: (page) => page.nextCursor,
      staleTime: 30_000,
    }),
};

const { promise, loadMore } = useInfiniteLane(feedLanes.list(filters));
lane.invalidate(feedLanes.list(filters)); // the key travels with it
```

Like `laneRead`, it is identity at runtime; what it buys is that `P` and `C` are
inferred and checked where the list is defined — `nextCursor` must return the
cursor `fetchPage` takes — instead of at each call site.

The value stored under the key — `P` is one page as your endpoint returns it,
`C` is your cursor type:

```ts
type InfiniteLaneValue<P, C> = {
  pages: P[]; // every page loaded so far, in order
  params: C[]; // the cursor each page was fetched with
  hasNext: boolean;
};
```

```tsx
const { promise, loadMore, isTransitionPending } = useInfiniteLane(
  ["feed", filters],
  {
    initialCursor: null as string | null,
    fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
    nextCursor: (page) => page.nextCursor,
  },
);

const { data, refreshError } = use(promise);
const items = data.pages.flatMap((page) => page.items);
```

Two things about this hook are worth knowing before you use it, because both are
easy to guess wrong.

**A re-read costs one request per page already loaded, and they run
sequentially.** Any refresh of the key — `invalidate`, focus, mount, a poll —
re-walks the chain from the first page, re-deriving each cursor from the page
that just came back, because page N+1's cursor does not exist until page N has.
A list five pages deep is five round trips, one after another. That is
inherent to cursor pagination rather than to Lane, and it is the same cost the
equivalent React Query list pays; see
[migrating](./migrating.md#step-6--infinite-lists). What Lane's model buys is
what the user sees while it happens: the list is held on screen by the
transition, and a failure part-way through keeps it there with `refreshError`
instead of moving the read into an error state.

**`hasNext` is in the resolved value, not on the hook.** The hook returns a
promise it never resolves, so it cannot know — and keeping the flag next to the
pages it describes is what stops the two disagreeing mid-render, the same reason
`refreshError` rides inside the value. The rule for this hook: **actions come
from the hook, data comes from `use(promise)`.**

Notes:

- **`loadMore` appends one page** through `update`, so the key never changes: the
  reader converges through a transition with the list still on screen, and
  `isTransitionPending` covers it with no `useTransition` of your own. It is a
  no-op at the end of the list; gate your control on `data.hasNext` so an
  over-eager click does not cost even a notification.
- **`fetchPage`'s `signal` is optional because it is genuinely absent on the
  append path.** A refresh runs as a read and gets the read's abort signal; an
  updater is handed the current value and no controller, so a `loadMore` in
  flight cannot be aborted. It is left optional rather than faked.
- **A list can come back shorter.** If a re-derived cursor returns `null` before
  the walk reaches the old depth, the walk stops there — rows were deleted
  underneath it, and the shorter list is the truth.
- **`loadMore`'s identity follows `fetchPage` / `nextCursor`.** It is a
  `useCallback` over those plus the lane and the serialized key, so it is stable
  exactly when the caller's functions are. An `onClick` does not care; driving it
  from an effect (a scroll sentinel) is the caller's `useEffectEvent`.
- **An auto-load trigger must also gate on `refreshError`.** A scroll sentinel is
  a loop, and only a change in what it observes stops it. A *successful* append
  stops it by adding rows (the sentinel moves) and eventually clearing
  `data.hasNext`. A *failed* one changes neither: the value is unchanged, so
  `hasNext` is still `true`, the sentinel is still on screen, and the pending flag
  has gone back down — so the observer fires again, forever, against a server that
  is already failing. Gate on all three facts, which is why they arrive together:

  ```tsx
  const { data, refreshError } = use(promise);
  // ...inside the IntersectionObserver effect:
  if (!data.hasNext || isTransitionPending || refreshError) return;
  ```

  `refreshError` clears on the next successful read, so recovery is an explicit
  retry — a button calling `loadMore` again, which resumes from the same cursor.
  A caller that would rather not route through the rendered value can await
  `loadMore` instead: it hands back the entry's next promise, which *resolves*
  with `refreshError` set rather than rejecting.
  Note that `retry` / `retryDelay` do **not** apply here: they belong to the read
  path, and an append is an `update`, so a failed page is surfaced rather than
  retried. (The equivalent React Query list has the same shape — `hasNextPage`
  stays `true` after a failed `fetchNextPage` — and gates on
  `isFetchNextPageError` instead.)
- **Depth is only as durable as the entry.** Remounting reuses the cached value
  with no request at all, and the depth comes back with it, so the *next* refresh
  covers every page again. An `invalidate` while *nothing* is mounted is the
  exception: it drops the entry (no cache, no subscriber), so the next mount
  starts from one page — the same asymmetry described under
  [`current`](#uselanekey-loader-options).

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
prefetch<T, C = T>(spec: LaneReadSpec<T, C>): Promise<LaneRead<T>>;

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
  exposes only `retry` / `retryDelay`. A
  [spec](#lanereadspec--key--loader-colocation) is warmed the same way — its
  `retry` / `retryDelay` apply and its freshness options are left to the reader,
  so `lane.prefetch(taskLanes.detail(id))` is the whole hover handler.

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
  invalidate(target: LaneTarget, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(target: LaneTarget, valueOrPromise: T | Promise<T>): Promise<LaneRead<T>>;
  update<T>(target: LaneTarget, updater: LaneUpdater<T>): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(target: LaneTarget): void;
  removeAll(scope: LaneScope): void;
  cancel(target: LaneTarget): void;
};

// A key, or anything carrying one — so a `laneRead` spec is accepted wherever
// its key would be. `set` / `update` / `prefetch` additionally take the spec's
// type from it, which is what makes those calls checked.
type LaneTarget = LaneKey | { key: LaneKey };
```

Every exact-key method takes either form:

```ts
lane.invalidate(["task", id]);
lane.invalidate(taskLanes.detail(id)); // same entry, one definition
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
  after?: Promise<unknown>;
};
```

- omit `onlyIf` → always invalidate.
- `"stale"` → only fulfilled entries older than `staleTime`.
- `"settled"` → only entries with a settled promise (skips in-flight reads).
- `background: true` → converge through the **background** transition
  (`isBackgroundPending`) instead of the default explicit one
  (`isTransitionPending`). Use it for automatic refreshes so they don't read as a
  user-driven invalidation — see [Polling](#polling).
- `after: promise` → invalidate now, fetch later. See below.

### Announcing an invalidation before the mutation finishes

The obvious way to converge after a mutation leaves every reader in the dark
while the mutation runs:

```ts
startTransition(async () => {
  await saveTodo(patch);   // readers show nothing for the whole request
  lane.invalidateAll(["todos"]);
});
```

Notification is Lane's only channel to a reader, and here it fires last — so
`isTransitionPending` only turns on once the work is already done. `after` moves
the notification to the front:

```ts
startTransition(async () => {
  const saved = saveTodo(patch);
  lane.invalidateAll(["todos"], { after: saved });
  await saved;
});
```

Readers go pending immediately and keep their current value on screen through
the transition; the actual re-read is held behind `saved` and starts the moment
it settles. Pending is continuous from the click to the fresh data.

#### When to reach for it

`after` is not the default shape for converging after a mutation. It changes
*when readers learn*, not when the fetch happens — that is already after the
action either way — so using it everywhere just holds pending on for longer. Work
down this list:

1. **The action resolves to the key's value** → [`set(key, promise)`](#set).
   It publishes the in-flight promise under that key, which marks readers pending
   the same way and saves the extra round-trip. Strictly better where it applies.
2. **You can show the outcome before it lands** → `useOptimistic`. The reader
   already shows the new state; marking it pending on top contradicts that.
3. **Otherwise, ask whether a reader would sit on stale data with no sign
   anything is happening.** If yes — a slow action that refreshes a list, a
   counter, and a detail view it returns none of — that is what `after` is for.

And when it isn't: if the pending signal is already where the user is looking —
a submit button driven by `useActionState` or its own `useTransition` — and the
affected reads are elsewhere or off-screen, the plain `await action; invalidate()`
shape is the right one. So is a fast action, where a flicker of pending reads
worse than none.

#### What to know

- **`after` decides when, not whether — including on failure.** A rejected action
  still lets the read run: the key was already invalidated, so the next read
  reflects whatever the source actually holds. Only settlement is observed — the
  resolved value is ignored, and a rejection never surfaces through Lane. This is
  the one real cost against the plain shape, which can keep the invalidation
  inside a `try` and skip it when the action fails. It matters when the action
  fails often and the refetch is expensive.
- **A gated read counts as in-flight.** It has no settled promise, so
  `onlyIf: "settled"` skips it and a poll cannot cut the pending window short.
- **A key nobody is reading keeps its value.** There is no reader to mark
  pending, so the entry is left as it is and invalidated when the action lands —
  what `await action; invalidate(key)` does. Navigating to it mid-action shows
  the last known value, then converges. This is what makes naming a whole family
  with `invalidateAll` safe.

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

Publishing through a [spec](#lanereadspec--key--loader-colocation) is
type-checked — the read's own type reaches the write, so the value has to be what
that key holds:

```ts
lane.set(taskLanes.detail(saved.id), saved);
// @ts-expect-error — not what this read loads
lane.set(taskLanes.detail(saved.id), { title: saved.title });
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

// Through a spec, `current` is typed by the read itself — no type argument.
lane.update(taskLanes.detail(id), (task) => ({ ...task, done: true }));
```

### `remove` / `removeAll`

Drop entries that no longer belong in client state — sign out, team switch, a
deleted selected entity. Removal is **urgent**: subscribed readers stop
rendering the removed promise immediately (no transition).

```ts
lane.remove(["task", id]);
lane.removeAll(() => true); // clear everything, e.g. on sign out
```

Removal drops the entry's **last fulfilled value** along with its cached promise,
so nothing can serve the removed data back: neither
[stale-on-error](#stale-on-error), which would otherwise fall back to it when the
next read fails, nor the next loader's [`current`](#uselanekey-loader-options).
This matters because an entry a reader still holds survives the removal itself —
the key slot stays, the value does not.

### `cancel`

Stop the key's in-flight read. Alone among these methods it does **not** converge
the key: nothing is notified, so subscribed readers keep the promise they hold
instead of starting again. A settled read is not in progress, so cancelling one
does nothing.

```ts
lane.invalidate(["report", id]);
lane.cancel(["report", id]); // changed my mind — stop the refresh, keep the rows
```

There is no `cancelAll`, and `useLane` returns no bound `cancel`. Scoped
operations exist for the ones that converge — `invalidateAll` / `updateAll` /
`removeAll` leave every key they touch in a defined state, whatever the
[scope](#scopes) matched. Cancelling does not: on a key with nothing to revert to
it leaves a rejection, so applying it to an unenumerated family means leaving one
on an unknown number of keys. (`set` and `prefetch` have no scoped twin either —
they need per-key knowledge, and here that knowledge is ownership.) A bound form
would be safe, but stopping a read is rare enough that it would be dead weight in
every reader's result.

**Only cancel a read you started and can still account for.** Two conditions,
both about the call site rather than about the cache:

1. **You issued this read** — your own `invalidate`, a load you are explicitly
   offering the user a way to stop, a key whose parameters are spent.
2. **Nothing else reads this key** — cancelling is addressed by key, so on a
   shared key one call stops your refresh *and* someone else's first load.

A read left behind by a superseded transition — switching tabs, retyping a search
— fails the first, and is the one place not to reach for this. Nobody issued those
requests: state changed, React chose to render it, and the read followed. See
[Cancelling is for reads you own](./design-notes.md#cancelling-is-for-reads-you-own).

Where the key lands is decided by what it already had:

| Key holds | Result |
| --- | --- |
| a last fulfilled value | reverts to it — readers keep showing their data, and **no `refreshError`**, since the caller asked for the stop |
| nothing to revert to | the read settles **rejected** — the only end a transition holding no data can reach |

The rejection is then as sticky as any other failed first load: it is reused until
the key is invalidated, removed, collected, or read with `whenStale: "refetch"`.
An Error Boundary reset alone re-reads the same rejected promise, so pair a retry
with an `invalidate`. That is deliberately not special-cased — a cancelled first
load recovers the way every other one does.

Cancelling holds whether or not the loader forwards its `signal`: a loader that
drops it runs to completion, but its result is not adopted. Forwarding it is still
what makes the request actually stop — see
[Don't drop the abort signal](./common-mistakes.md#dont-drop-the-abort-signal).

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
- **The last fulfilled value.** One value per entry backs both the stale-on-error
  fallback above and the [`current`](#uselanekey-loader-options) a loader is
  handed. It outlives invalidation (which clears the cached promise, not the
  value) and is dropped by [`remove`](#remove--removeall), by garbage collection,
  and by an invalidation of an entry no reader is holding — that last one deletes
  the entry outright, since it has neither a cache nor a subscriber left.
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

`InfiniteLaneOptions`, `InfiniteLaneReadSpec`, `InfiniteLaneResult`, `InfiniteLaneValue`,
`Lane`, `LaneEntryInfo`, `LaneEventSource`, `LaneGatedReadSpec`, `LaneGatedResult`, `LaneHydrationSnapshots`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneOptions`,
`LanePrefetchOptions`, `LaneRead`, `LaneReadSpec`, `LaneRefetchOnFocus`, `LaneRefetchOnMount`, `LaneRefetchOnReconnect`,
`LaneResult`, `LaneRetryDelay`, `LaneRevalidateHandlers`,
`LaneScope`, `LaneSnapshot`, `LaneTarget`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`, `LaneWhenStale`,
`ReactNativeAppState`, `ReactNativeEventSourceOptions`, `ReactNativeNetInfo`.

Runtime exports beyond the hooks and `createLane`: `laneRead`,
`infiniteLaneRead` (see [`laneRead`](#lanereadspec--key--loader-colocation)),
`domEventSource`, `noopEventSource`, `createReactNativeEventSource` (see
[Event sources](#event-sources)).

## See also

- [Common mistakes](./common-mistakes.md) — anti-patterns and the use-lane way to write them.
- [Supported architectures](./architectures.md) — RSC-first and RSC-seeded client ownership.
- [Design notes](./design-notes.md) — the rationale behind these choices.
- [Cross-reader consistency](./consistency.md) — what two readers of one key are
  guaranteed to show each other.
