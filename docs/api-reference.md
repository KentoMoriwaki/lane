# API Reference

`use-lane` is a promise-identity cache for React 19. Lane owns which promise each
key currently renders; React owns loading (Suspense), errors (Error Boundaries),
convergence (transitions), and optimistic UI (`useOptimistic` /
`useActionState`).

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

### `createLane()`

Creates a `Lane` instance directly. Most apps never call this — `LaneProvider`
creates one for you. Use it to share a single instance across multiple providers
or to construct one outside React.

```ts
const lane = createLane();
```

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
- **`loader`** — `({ key, signal }) => Promise<T>`. Called when the key has no
  cached promise. The `signal` aborts when the in-flight read is discarded
  (invalidation, removal, an authoritative `set` over a pending read, or GC).
- **`options`** — see [`LaneUseOptions`](#laneuseoptions).

Returns a [`LaneResult<T>`](#laneresultt). Read the data with `use(result.promise)`
inside a `Suspense` boundary:

```tsx
const { promise } = useLane(["task", id], ({ signal }) => fetchTask(id, signal));
const task = use(promise);
```

The hook keeps the current promise in React state. When the key changes during
render, it switches to the new key's promise immediately (no extra render of the
old data). When the entry is invalidated, set, updated, or removed elsewhere, the
subscribed hook re-reads through the appropriate transition.

### `useLanePromise(key, loader, options?)`

Thin wrapper that returns only the promise. Equivalent to
`useLane(...).promise`. Use it at call sites that do not need pending state,
`refreshError`, or the local `invalidate`.

```ts
const task = use(useLanePromise(["task", id], loader));
```

### `LaneResult<T>`

```ts
type LaneResult<T> = {
  promise: Promise<T>;
  refreshError: unknown;
  isTransitionPending: boolean;
  isBackgroundPending: boolean;
  invalidate: () => void;
};
```

| Field | Description |
| --- | --- |
| `promise` | The current promise for the key. Unwrap with `use(promise)`. |
| `refreshError` | The error from a failed **refresh** of an entry that already has data (see [Stale-on-error](#stale-on-error)). `undefined` when the latest read succeeded. Initial-load failures reject `promise` instead. |
| `isTransitionPending` | `true` while an explicit invalidation (`invalidate`, `invalidateAll`, `set`, `update`) is converging through a transition. |
| `isBackgroundPending` | `true` while a background revalidation (focus / mount / polling / reconnect / subscription catch-up) is converging. |
| `invalidate` | Invalidate this exact key and re-read through a transition. Convenience for `lane.invalidate(key)`. |

### `LaneUseOptions`

```ts
type LaneUseOptions = {
  staleTime?: number;
  gcTime?: number;
  retry?: number;
  retryDelay?: (attempt: number, error: unknown) => number;
  refetchInterval?: number;
  refetchOnFocus?: boolean | "always";
  refetchOnMount?: boolean | "always";
  refetchOnReconnect?: boolean | "always";
};
```

| Option | Default | Description |
| --- | --- | --- |
| `staleTime` | `0` | How long (ms) a fulfilled value is considered fresh. Stale entries are eligible for `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` reloads. |
| `gcTime` | `300000` (5 min) | How long an entry with no subscribers is kept before collection. `Infinity` opts out. The largest `gcTime` across subscribers wins. |
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

Get the instance from `useLaneInstance()` (or `createLane()`).

```ts
type Lane = {
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: T | Promise<T>): Promise<T>;
  update<T>(key: LaneKey, updater: LaneUpdater<T>): Promise<T> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<T>[];
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
- **Garbage collection.** An entry with no subscribers is collected `gcTime` ms
  after its last subscriber leaves (default 5 min; `Infinity` opts out). This
  also collects entries from renders that never committed.

## Type exports

`Lane`, `LaneEntryInfo`, `LaneHydrationSnapshots`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneRefetchOnFocus`,
`LaneRefetchOnMount`, `LaneRefetchOnReconnect`, `LaneResult`, `LaneRetryDelay`,
`LaneScope`, `LaneSnapshot`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`.

## See also

- [Supported architectures](./architectures.md) — RSC-first and RSC-seeded client ownership.
- [Design notes](./design-notes.md) — the rationale behind these choices.
