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
  external,
  useLane,
  useLanePromise,
  useLanesAll,
  useInfiniteLane,
  useLaneInstance,
  laneRead,
  infiniteLaneRead,
  laneKey,
  createLane,
} from "use-lane";
```

Requires React **19.2+** (`useEffectEvent`). React is a peer dependency.

## Setup

### `LaneProvider`

Provides a `Lane` instance to the tree and wires focus / reconnect revalidation
from a pluggable event source.

```tsx
<LaneProvider lane?={Lane} refresh?={() => void} focusThrottleInterval?={number} eventSource?={LaneEventSource}>
  {children}
</LaneProvider>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `lane` | `Lane` | a fresh `createLane()` | The Lane instance to provide. Omit to let the provider create and own one. |
| `refresh` | `() => void` | — | How Lane asks the owner of an [`external`](#external--a-read-the-owner-publishes) key to publish it again — `() => router.refresh()`, `() => useRevalidator().revalidate`. Installed on the lane above, so this and `createLane({ refresh })` are the same setting; an absent prop leaves whatever `createLane` was given. See [`refresh`](#refresh--the-owner-ask). |
| `loaderMeta` | `LaneRegister["loaderMeta"]` | — | **Required only if you declare it** (see [`LaneRegister`](#laneregister--what-loaders-are-handed-besides-the-key)). What every loader on this lane is handed as `meta`. Absent from the props entirely when nothing is declared. |
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
  warmTime?: number;
  refresh?: () => void;
};
```

| Option | Default | Description |
| --- | --- | --- |
| `gcTime` | `300000` (5 min) | How long (ms) an entry is kept **after its last reader leaves** — the default for reads that do not set their own. Idle-time based, unrelated to `staleTime`/freshness. `Infinity` opts out. |
| `warmTime` | `60000` (1 min) | How long a settled entry **nobody has ever held** waits for its first reader — the default for reads that do not set their own. Shorter than `gcTime`'s and unrelated to it: this is spent on an arrival that has not happened (a hover prefetch, a render that suspended and went away), that one on a reader who was there and may return. |
| `refresh` | — | The owner-ask for [`external`](#external--a-read-the-owner-publishes) keys. See [`refresh`](#refresh--the-owner-ask). |

#### `refresh` — the owner-ask

An external read has no loader of its own to re-run, so what it does about a
value it has not got is ask the owner to render again. `refresh` is that ask,
and the app supplies it because only the app knows what "render again" means:

```tsx
// Next.js App Router
const router = useRouter();
<LaneProvider refresh={() => router.refresh()}>

// React Router, data mode
const revalidator = useRevalidator();
<LaneProvider refresh={revalidator.revalidate}>
```

Lane calls it when a reader reads an external key that has held a value before
and has none now — after `invalidate`, after `remove`, after the value was
collected with its payload. The rules:

- **Out of render, once per tick per lane.** Reads run during render and
  `router.refresh()` dispatches a React update, so the call is deferred to a
  microtask; N readers of N keys invalidated in one run are one ask.
- **On the read, not on the wait.** Next's router discards a pending
  `router.refresh()` when a navigation starts, so an ask made once and never
  repeated would leave a wait unfilled. Every read of an unfilled wait asks
  again, which is how a reveal after a navigation repairs itself.
- **And again while someone is still waiting.** A reader that is already
  suspended does not read again on its own — it re-renders only when its
  promise settles — so a read-driven ask cannot repair *that* reader when its
  ask was aborted (a mutation that invalidates a key and then navigates does
  exactly this). For as long as a wait that was asked for is unsettled and a
  committed reader is subscribed to it, Lane looks again every `REASK_INTERVAL`
  (2 s) and asks once more; a publication ends it, and so does the wait's own
  timeout. A wait nobody is subscribed to — a hidden tree's — is not re-asked
  for: its reveal reads and asks for itself. The cost is one render the aborted
  ask had already paid for; the measurement is in [the two mutation
  channels](./integrations.md#the-two-mutation-channels).
- **Never before the first publication.** A reader mounting under streaming SSR,
  or outside every `<LaneHydration>` boundary, is waiting for a payload that is
  already on its way. It waits in silence.
- **No in-flight tracking.** `refresh` returns `void`, so there is no completion
  to observe, and inferring one from the next publication is wrong — a
  navigation's payload need not carry the key at all. Repeated asks across ticks
  cost round trips, not correctness.

Without a `refresh`, a reader whose external key was invalidated or collected
waits out [`LaneExternalTimeoutError`](#laneexternaltimeouterror) — which is
what the timeout's message says to do about it.

## Reading data

### `useLane(read)`

Subscribe a component to a keyed async read. A read is **one value** — its key,
its loader, and the options it is read with:

```ts
function useLane<T, C = T>(read: LaneReadSpec<T, C>): LaneResult<T>;

type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneClientLoader<T, C>;
  fallback?: LaneFallback<T>;
};
```

- **`key`** — a structural array (`["task", id]`). See [Keys](#keys).
- **`loader`** — `({ key, signal, current, meta }) => Promise<T>`, or
  [`external`](#external--a-read-the-owner-publishes) when the key is published
  rather than fetched, or `undefined` to gate the read off (see [Conditional
  reads](#conditional-reads-gating)). Three values, one question: who fills this
  key.
  Called when the key has no cached promise. The `signal` aborts when the
  in-flight read is discarded (invalidation, removal, an authoritative `set` over
  a pending read, or GC). `meta` is whatever the lane carries — the session or
  request context a loader needs that is not part of its key; it is `undefined`
  unless you declare it (see
  [`LaneRegister`](#laneregister--what-loaders-are-handed-besides-the-key)).
- **the rest** — see [`LaneUseOptions`](#laneuseoptions). They ride flat on the
  same object.

Write it inline for a one-off read, or build it with
[`laneRead`](#lanereadspec--key--loader-colocation) when the read is used in more
than one place — same value either way, and every consumer of a read takes it.

**`current`** is the entry's last fulfilled value, or `undefined` on a first
load — snapshotted when the read is created. It lets a loader re-read *as much
as it already had* rather than only what the key describes: the accumulated
pages of a list, a cursor to resume from, a revision to send as `If-None-Match`.
It survives invalidation (which clears the cached promise, not the last
fulfilled value) and is `undefined` again once the entry itself is gone —
[removed](#remove--removeall), collected, or invalidated while nothing was
subscribed to hold it — so a loader must always define what a first load means.
It is not a way to skip work: the value is the previous read's, and returning it
unchanged strands the entry on stale data.

Its type is the read's **second type parameter, defaulting to the loaded type**,
so annotating the read is what types it:

```tsx
const { promise } = useLane<Feed>({
  key: ["feed"],
  loader: async ({ current, signal }) => {
    const since = current?.cursor ?? null; // current: Feed | undefined
    return fetchFeedSince(since, signal);
  },
});
```

Reading `current` without that annotation is a type error asking for one, never a
silent `any`. The loaded type stays in the return position, so a loader that
ignores `current` keeps inferring with no type argument. [Why it is shaped this
way](./design-notes.md#a-loaders-input-includes-what-it-already-produced).

Returns a [`LaneResult<T>`](#laneresultt). Unwrap `result.promise` with `use()`
inside a `Suspense` boundary — it resolves to a [`LaneRead<T>`](#lanereadt)
(`{ data, error }`):

```tsx
const { promise } = useLane({
  key: ["task", id],
  loader: ({ signal }) => fetchTask(id, signal),
});
const { data: task, error } = use(promise);
```

The hook keeps the current promise in React state. When the key changes during
render, it switches to the new key's promise immediately (no extra render of the
old data). When the entry is invalidated, set, updated, or removed elsewhere, the
subscribed hook re-reads through the appropriate transition.

### `useLanePromise(read)`

Thin wrapper that returns only the promise. Equivalent to
`useLane(...).promise`. Use it at call sites that do not need pending state or
the local `invalidate`.

```ts
const { data: task } = use(useLanePromise({
  key: ["task", id],
  loader,
}));
```

### `laneRead(spec)` — key + loader colocation

Every read *is* one value — [`useLane`](#uselaneread) takes nothing else. What
`laneRead` adds is a place to write that value **once** and the types that follow
from it. It is Lane's equivalent of react-query's `queryOptions()`.

```ts
function laneRead<T, C = T>(
  spec: LaneReadSpec<T, C>,
): LaneReadSpec<T, C> & { key: LaneKeyOf<T> };
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
const { promise, isInvalidationPending } = useLane(taskLanes.detail(id));
const { data: task } = use(promise);
```

**Reads take the whole read; entry operations take its `key`.**

| Consumer | Call |
| --- | --- |
| [`useLane`](#uselaneread) | `useLane(taskLanes.detail(id))` |
| [`useLanePromise`](#uselanepromiseread) | `use(useLanePromise(taskLanes.detail(id)))` |
| [`useLanesAll`](#uselanesallreads-options--a-batch-read) | `useLanesAll(ids.map(taskLanes.detail))` |
| [`useInfiniteLane`](#useinfinitelaneread--a-cursor-paginated-list) | `useInfiniteLane(feedLanes.list(filters))` — built with [`infiniteLaneRead`](#infinitelanereadspec) |
| [`prefetch`](#prefetch) | `lane.prefetch(taskLanes.detail(id))` |
| [`invalidate`](#invalidate--invalidateall) / [`remove`](#remove--removeall) / [`cancel`](#cancel) | `lane.invalidate(taskLanes.detail(id).key)` |
| [`set`](#set) / [`update`](#update--updateall) | `lane.set(taskLanes.detail(task.id).key, task)` — checked |

The split is not arbitrary. `prefetch` *performs* a read, so it needs the loader;
publishing, invalidating, and removing *address an entry*, and none of them does
— so the loaded type travels on the **key** instead: see
[`LaneKeyOf`](#lanekeyoft--a-key-that-knows-what-it-holds).

**Why colocate.** A key factory in one module and a fetcher in another are two
halves of one fact, and nothing checks that a call site pairs them correctly.
Options drift the same way, and more quietly: they live at the call site while
the key does not, so one component reads a key with `staleTime: 60_000` and the
next reads the same key with none.

**The definition is also the unit of sharing.** A read used in more than one
place is shared by exporting its definition, not by wrapping `useLane` in a
custom hook — a wrapper that returns `use(promise)` fixes the suspension point
for every consumer, and a hook cannot serve the read's non-React consumers
(`prefetch`, entry operations via `.key`, RSC snapshots). See
[wrapping the read in a custom hook](./common-mistakes.md#wrapping-the-read-in-a-custom-hook).

**What the factory buys you.** At runtime it returns its argument. What it adds
is types: `T` is inferred at the definition from the loader's return type, and
the `key` it hands back is a
[`LaneKeyOf<T>`](#lanekeyoft--a-key-that-knows-what-it-holds), which is how the
type reaches the write side. The shape is also checked where it is written, so a
mistyped option is an error at the definition rather than a silently ignored
property at three call sites.

`C` — the type of [`current`](#uselaneread) — still defaults to `T`
and is still given explicitly (`laneRead<Feed, Cursor>({ … })`) for a loader whose
`current` is deliberately narrower or wider than its result.

**Gating works unchanged.** A spec whose `loader` is `undefined` is a
[gated read](#conditional-reads-gating): `LaneGatedReadSpec<T, C>`, and
`useLane` hands back a [`LaneGatedResult<T>`](#lanegatedresultt).

**A spec describes one read, not a family.** Parameters live in the enclosing
factory, which is what makes the key and the loader agree — both close over the
same variables. A dependency that is *not* part of the key (a session, a tenant,
an API client) does not belong in the factory's arguments: declare it on the
lane instead — see
[`LaneRegister`](#laneregister--what-loaders-are-handed-besides-the-key).

**Overriding at a call site is a spread** — the spec is a plain object:

```tsx
const { promise } = useLane({ ...taskLanes.detail(id), refetchOnFocus: true });
```

**No registry, no identity rules.** Two calls to the same factory produce two
objects with equal keys, and Lane addresses entries by serialized key. Build
specs per render, in an event handler, or on the server — nothing needs
memoizing for identity. (`useLanesAll` still wants a
[stable `reads` array](#uselanesallreads-options--a-batch-read).)

**Scoped operations still take a scope.** `invalidateAll` / `updateAll` /
`removeAll` take a prefix or predicate, never one read's key —
`lane.invalidateAll(["tasks"])`. See
[Key matching](./design-notes.md#key-matching-exact-vs-scoped).

> `laneRead` *describes* a read; [`LaneRead<T>`](#lanereadt) is what one
> *resolves to*.

### `LaneRegister` — what loaders are handed besides the key

Most loaders need something the key does not carry: a session, a tenant, an API
client, a request context. Declaring it once makes it available to every loader
as `meta`, without any read taking it as an argument.

```ts
// Once per app.
declare module "use-lane" {
  interface LaneRegister {
    loaderMeta: WorkspaceCtx;
  }
}
```

```tsx
<LaneProvider loaderMeta={ctx}>{children}</LaneProvider>
```

```ts
export const taskLanes = {
  detail: (id: string) =>
    laneRead({
      key: ["task", id],
      loader: ({ meta, signal }) => fetchTask(meta, id, signal),
    }),
};
```

**The problem it solves is the key, not the plumbing.** Binding a context into
the factory — `taskLanes(ctx).detail(id)` — works for reading and breaks
everywhere else, because naming an entry now requires a context: a mutation, a
Server Component, an error-boundary retry. Putting the dependency on the lane
keeps the read a plain object whose arguments are exactly what decides its key,
so `.key` costs nothing to reach:

```ts
lane.set(taskLanes.detail(id).key, task);      // no context needed
laneSnapshot(taskLanes.list(filters), tasks);  // in an RSC
```

The mechanism is react-query's `Register`, and so is the asymmetry in naming:
`loaderMeta` is what you **declare and supply**, `meta` is what the loader
**receives**.

| | Declared | Not declared |
| --- | --- | --- |
| `LaneProvider` | `loaderMeta` is **required** | prop absent |
| `lane.prefetch` | `prefetch(read, { loaderMeta })` | `prefetch(read)` |
| `meta` in a loader | typed, **non-optional** | `undefined` |

Nothing about a read's type changes: `LaneReadSpec` gains no type parameter,
`useLane` gains no overload, and an app that declares nothing is unaffected.

#### Per-read override

A single read that belongs to another context can say so:

```ts
useLane({ ...taskLanes.detail(id), loaderMeta: otherTenant });
```

It is optional and safely so — the lane always has a value, so this narrows a
guarantee rather than standing in for a missing one, and `meta` stays
non-optional inside the loader. In a batch, a member's own value wins over the
batch's.

#### The one obligation: it is not part of the key

Two reads of one key under different `loaderMeta` **name the same entry**, and
whichever loaded first wins. Lane will not invalidate anything when the value
changes, because it cannot know what the value owns. So either scope what it
owns into the key, or drop those keys when it changes:

```ts
// On a team switch — the keys omit teamId, so they must be dropped explicitly.
for (const scope of [["tasks"], ["projects"], ["insights"]]) {
  lane.removeAll(scope);
}
```

**One declaration per app, one value per provider.** The type is program-wide
(module augmentation), so an app has exactly one `loaderMeta` type; the *value*
is per provider, and providers nest.

### `LaneKeyOf<T>` — a key that knows what it holds

```ts
function laneKey<T>(key: LaneKey): LaneKeyOf<T>;

type LaneKeyOf<T> = LaneKey & { readonly [tag]: T }; // phantom; nothing at runtime
```

A key is where type information goes to die in a cache API: `["task", id]` is an
array of two strings, and nothing in it says `Task`, so `lane.set(["task", id],
anything)` can only take the caller's word for it. A `LaneKeyOf<Task>` is the
same array carrying its loaded type in a phantom property, which makes the write
checkable:

```ts
lane.set(taskLanes.detail(id).key, task); // ✓
lane.set(taskLanes.detail(id).key, project); // ✗ not what this key holds
lane.update(taskLanes.detail(id).key, (task) => ({ ...task, done: true })); // `task` is Task
```

`laneRead` stamps the tag from its loader's return type, so a colocated read is
already the source of a typed key — `spec.key`. Use `laneKey` for the other half
of a codebase, the one that only writes:

```ts
// keys.ts — no loaders, no request context, importable from anywhere.
export const taskKeys = {
  detail: (id: string) => laneKey<Task>(["task", id]),
  list: (filters: TaskFilters) => laneKey<Task[]>(["tasks", filters]),
};

// mutations.ts
lane.set(taskKeys.detail(saved.id), saved); // checked, and nothing else imported
```

A read can be built on an already-typed key — `laneRead({ key: taskKeys.detail(id),
loader })` — and what it hands back is tagged from its own loader either way. The
two are deliberately *not* checked against each other (the check was measured at
~65% more type instantiations per read, for a mismatch you have to construct on
purpose).

Three things to know:

- **The tag is an assertion, not a proof.** `laneKey<Task>(…)` states what the
  entry holds and nothing verifies it. `laneRead` *infers* the tag from the
  loader; a `laneKey` type argument is the one place in Lane where you state a
  type by hand.
- **A tagged key is a key.** Same array at runtime, same entry, same
  serialization, accepted anywhere `LaneKey` is. Only `set` and `update` read
  the tag.
- **`laneKey` runs on the server too.** `use-lane` marks its React modules
  `"use client"` individually rather than marking the package, so `laneKey`,
  `laneRead`, and `createLane` are importable from a Server Component — including
  the RSC route that builds your [hydration snapshots](#hydration-rsc-seeding).
  Same `"use-lane"` import path in both graphs.

### `LaneResult<T>`

```ts
type LaneResult<T> = {
  promise: Promise<LaneRead<T>>;
  isInvalidationPending: boolean;
  isBackgroundPending: boolean;
  invalidate: (options?: LaneInvalidateOptions) => Promise<LaneRead<T>>;
  startInvalidationTransition: (action: () => unknown) => void;
};
```

| Field | Description |
| --- | --- |
| `promise` | The current promise for the key. Unwrap with `use(promise)` to get a [`LaneRead<T>`](#lanereadt). |
| `isInvalidationPending` | `true` while an explicit invalidation (`invalidate`, `invalidateAll`, `set`, `update`) is converging through a transition. |
| `isBackgroundPending` | `true` while a background revalidation (focus / mount / reconnect / a `background: true` invalidation) is converging. |
| `invalidate` | Invalidate this exact key, re-read, and return **the next read's promise** — awaitable, unlike `lane.invalidate` (a key alone does not know its loader; the hook holds the whole read). The returned promise is the one subscribed readers adopt, by the store's dedupe — never a second fetch — and it keeps the read's usual contracts: a failed load with something to serve resolves `{ data, error }`, one with nothing to serve rejects, and resolving means the data settled, not that React committed. An invalidation skipped by `onlyIf` returns the current cached promise, so awaiting is always awaiting "the key's value after this call". Accepts the same `LaneInvalidateOptions`. See [Derived reads](#derived-reads--reacting-to-a-source-that-actually-changed). |
| `startInvalidationTransition` | Run an action inside this reader's invalidation transition, so `isInvalidationPending` is on from when it *starts*. See [below](#startinvalidationtransition--pending-from-the-start-of-an-action). |

### `startInvalidationTransition` — pending from the start of an action

`await action(); invalidate()` tells readers only at the end: notification is
Lane's only channel to them, and it fires last, so the whole request is stale
data with no sign anything is happening. Running the action *inside* the
reader's transition moves that to the front:

```tsx
const { promise, isInvalidationPending, invalidate, startInvalidationTransition } =
  useLane(taskLanes.list(filters));

function save(patch: Patch) {
  startInvalidationTransition(async () => {
    await saveTask(patch);
    invalidate();
  });
}
```

`isInvalidationPending` is on from the click, stays on across the action *and*
the re-read it triggers, and clears when the new data commits — one window, not
two. The reader keeps its current value on screen throughout, because that is
what a transition does.

**For the other keys a mutation touches, call
[`lane.startInvalidationTransition(scope)`](#mutation-convergence--the-lane-instance)
inside the action.** Their readers are told to open their transitions in the same
synchronous fan-out, so every reader in the window goes pending in one tick
rather than one screen at a time:

```ts
// The component runs the action and knows nothing about its reach:
startInvalidationTransition(async () => {
  await saveTask(patch);
  invalidate();
});

// …and the mutation announces its own, wherever it lives:
export async function saveTask(patch: Patch) {
  lane.startInvalidationTransition(["insights"]);
  await api.saveTask(patch);
  lane.invalidate(["insights"]);
}
```

Inside the action rather than as an argument, because that is where the
knowledge is: a mutation helper knows which keys it touches and its caller does
not.

#### What to know

- **The action is not Lane's.** Its resolved value is ignored and its rejection
  is never caught, so a failed save cannot reach a reader as
  [`error`](#lanereadt) — that field means a *load* of this key failed over data
  still worth showing. Handle the failure inside the action.
- **Nothing is stored when the window opens.** An announcement schedules no read
  — the caller has not changed the source yet. Converge inside the action,
  however the change needs it: `invalidate`, `set`, `update`, a prefix scope —
  all land in the same transition.
- **External reads have it too.** A published key's reader can be told an
  invalidation is coming exactly like any other, and the invalidation it is
  waiting for is real: the value goes and the owner is asked for a new one. A
  scope that mixes published and client-owned keys announces to both.
- **`lane.startInvalidationTransition` outside any transition is close to a
  no-op** — each reader opens an empty transition that commits immediately.
  There is no way to ask React whether a transition is in progress, so it is
  documented rather than guarded.

### Derived reads — reacting to a source that actually changed

Some reads derive from another read's *content* — syntax highlighting derived
from a source file, analysis derived from a document — and refreshing the
source should refresh them only when the content really changed. Lane gives you
two ways to say that, and which to pick depends on what identity you have.

**Cascade on an awaited refresh.** The bound `invalidate` returns the next
read, and [structural sharing](#structural-sharing) guarantees that `===` on
`data` is a precise change check — a refetch that came back deep-equal keeps
the previous reference. So the cascade is a comparison away, inside the
[transition](#startinvalidationtransition--pending-from-the-start-of-an-action)
so everything converges as one window:

```tsx
const { promise, invalidate, startInvalidationTransition } = useLane(sourceRead(path));
const source = use(promise);

function reload() {
  startInvalidationTransition(async () => {
    const next = await invalidate();

    if (next.data !== source.data) {
      // the content really changed — everything derived from it is stale
      lane.invalidate(prepareRead(source.data.documentId).key);
      lane.invalidateAll(["analysis", "query", source.data.documentId]);
    }
  });
}
```

This keeps derived keys simple and every entry's continuity (structural
sharing, `current`, stale-on-error) intact. Its limits: the derived set is
enumerated by hand, and only paths that `await` the refresh cascade — an
automatic revalidation (focus / reconnect / mount) refreshes the source alone.

**Fold the identity into the derived key.** When the source's content has a
name — a server-provided hash or version, or Lane's own
[`revision`](#lanereadt) when it does not — put it in the derived read's key.
The derived key then changes exactly when the content does, whatever triggered
the refresh, and the new pair lands in one commit (the key switch and the
suspension happen in the same transition render):

```tsx
const source = use(useLane(sourceRead(path)).promise);
const prepared = use(
  useLane(prepareRead(source.data.documentId, source.revision)).promise,
);
```

No cascade to enumerate and no way to render a new source against stale derived
data — at the price that each identity is a fresh entry: a new-key load starts
from nothing (no `current`, no stale-on-error fallback), and old entries idle
out through `gcTime`. A server-provided hash is the stronger key material when
you have one — stable across sessions and reverts — where `revision` is
session-local and only ever moves forward.

### `LaneRead<T>`

What a read resolves to — `use(promise)` returns this:

```ts
type LaneRead<T> = {
  data: T;
  revision: number;
  error?: unknown;
};
```

| Field | Description |
| --- | --- |
| `data` | The value for the key. |
| `revision` | The identity of `data`'s **content** — a serializable stand-in for the reference equality [structural sharing](#structural-sharing) guarantees. A refetch that came back deep-equal keeps the previous reference *and* the previous revision; only a genuine content change (through any write path) mints a new one, from a lane-wide counter. Equality is the entire contract — nothing about order or density may be read into the numbers, and they are session-local: never serialize one into a snapshot. What it is for is naming content where a reference cannot go — chiefly as **key material for a derived read**: `useLane(prepareRead(source.data.documentId, source.revision))`. For comparing two reads you already hold, `revision` adds nothing over `===` on `data`. A stale-on-error result keeps serving the old data under the old revision — the pair is one settlement and cannot tear. **On an [external](#external--a-read-the-owner-publishes) read the identity is the publication's, not the content's**: an external entry keeps no previous value to compare against, so every publication mints a new revision, a republish of identical content included. Same revision ⇒ same content still holds; the converse does not. When the content has a real version, ship it in the payload and key on that instead. |
| `error` | The failure of the load that would have produced `data`, present when something else is being served in its place — the last fulfilled value, or what the read's [`fallback`](#fallback--what-a-read-serves-when-its-load-fails) returned (see [Falling back](#stale-on-error)). Absent when the latest load succeeded, and absent after a `cancel` (the caller asked for the stop). Its presence says `data` did not come from a successful load; it does **not** say the read is broken — treat it as a reason to annotate, not a reason to discard what is on screen. A load with nothing to serve rejects `promise` instead. Carrying the error *in the resolved value* (rather than a field read live from the store during render) keeps `data` and `error` consistent under concurrent rendering — which is why it is here and not on `useLane`. |

### `LaneGatedResult<T>`

What `useLane` / `useLanePromise` return when the loader may be `undefined` —
`promise` widens to `Promise<LaneRead<T>> | undefined`, and `invalidate` widens
the same way (while disabled there is no loader to re-read with, so it still
clears the entry but has no next read to return):

```ts
type LaneGatedResult<T> = Omit<LaneResult<T>, "promise" | "invalidate"> & {
  promise: Promise<LaneRead<T>> | undefined;
  invalidate: (options?: LaneInvalidateOptions) => Promise<LaneRead<T>> | undefined;
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
const detail = useLane({
  key: ["component", componentId],
  loader: componentId
    ? ({ signal }) => fetchComponent(componentId, { signal })
    : undefined,
});
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

### `fallback` — what a read serves when its load fails

A read that declares `fallback` decides for itself whether a failed load has an
answer, and what it is. Without one, the built-in policy applies: serve the last
fulfilled value if there is one, and otherwise reject.

```ts
laneRead({
  key: ["quota"],
  loader: fetchQuota,
  fallback: ({ lastFulfilled }) => lastFulfilled ?? EMPTY_QUOTA,
});
```

That read never reaches an Error Boundary. A first load that fails resolves to
`{ data: EMPTY_QUOTA, error }`, so a non-essential corner of a screen — a usage
meter, a tag list, a badge — can fail without taking a subtree with it, and say
so inline if it wants to.

```ts
type LaneFallback<T> = (context: {
  error: unknown;
  key: LaneKey;
  lastFulfilled: T | undefined;
}) => T;
```

**It runs on every failed load, not only the first** — calling it only when
there is nothing to serve would make the same failure behave differently
depending on history the caller cannot see. That is what lets the whole policy
be read off the definition:

| policy | what it says |
| --- | --- |
| `({ lastFulfilled }) => lastFulfilled ?? EMPTY` | keep showing data if there is any, otherwise show empty |
| `({ error, lastFulfilled }) => isMissing(error) ? EMPTY : (lastFulfilled ?? raise(error))` | a missing resource is empty; anything else keeps data, or fails |
| `({ error }) => { throw error }` | never serve a value that is not current |

The last one is not reachable any other way. For data where showing a stale value
is itself wrong — a balance, a lock state, a permission — this is how a read
says so.

**What it returns is served, never stored.** `lastFulfilled` moves only on a
genuine success and the entry keeps the freshness it had — a read that fell back
is still as stale as it was and still refreshes on the next trigger. A policy
that hands back what it was given serves it under the entry's own
[`revision`](#lanereadt); a substitute the entry never held carries one of its
own. A read that has never succeeded counts as old as a value can be, which
keeps the triggers firing on a key that is failing; `staleTime: Infinity` still
means what it says, and pins it. This is the whole reason it is a read option
rather than a `try` / `catch`
inside the loader: a loader that catches and returns a substitute has
*succeeded* as far as the store can tell — the substitute becomes the last
fulfilled value, the fulfillment time is restamped so the entry stops
refreshing, and a new revision is minted.

**Throwing is how a policy declines.** There is no sentinel return, because
`undefined` may be a legitimate `T`. Rethrowing the error it was handed lands
where the built-in policy's empty case lands — a rejected promise carrying
[`LaneReadError`](#lanereaderror) with the key. A policy that throws something
else has replaced the failure with its own account of it, and that is what the
boundary receives.

**Synchronous.** Returning a promise would be a second loader, and retrying a
failed request belongs to the fetcher.

**It is not in [`LaneUseOptions`](#laneuseoptions).** It is the one read option
typed by the read's `T`, and that type set has no `T` — which is also why a
batch's shared options cannot carry one: a member of
[`useLanesAll`](#uselanesallreads-options--a-batch-read) falls back exactly as
its own read defines it, or not at all.

**Which read's policy runs** is the one whose loader produced the failure — the
read that started the load, as with `loaderMeta`.

A `cancel` is not a failure, so it never consults the policy: the read reverts
to the last fulfilled value with no `error` beside it.

[`external`](#external--a-read-the-owner-publishes) reads take no `fallback`.
Their only failure is [`LaneExternalTimeoutError`](#laneexternaltimeouterror),
which says the ask went unanswered — a wiring bug, and serving something in its
place would hide it behind a plausible screen.

### `external` — a read the owner publishes

> An external read is an ordinary read whose loader the owner holds: the value
> arrives by publication, and a re-read asks the owner to publish again.

Some keys are not the client's to *fetch*. An RSC route already loaded the data
and [publishes](#lanehydration) it; a router loader did the same. The read still
has to say where its value comes from, and `external` is that declaration — a
real loader that **waits for the publication** instead of going after the data
itself:

```ts
import { external, laneRead } from "use-lane";

export const taskLanes = {
  detail: (id: string) => laneRead<Task>({ key: ["task", id], loader: external }),
};

const { promise } = useLane(taskLanes.detail(id)); // no fetch — it waits
```

It is a genuine loader value, not a flag: the loader slot answers "who fills
this key" with three values — a function is client-owned, `external` is
published from outside, `undefined` is [gated off](#conditional-reads-gating).

**`T` is annotated, because nothing infers it.** `laneRead<Task>({ … })` — a
loader that never loads has no return type to read it from.

**The spec takes the key and the loader, and nothing else.** Writing any other
option is a type error at the `laneRead` call:

| Absent option | Why |
| --- | --- |
| `staleTime` | Freshness is the owner's. A client-side freshness policy on this key would be a second authority over when it changes — the line this design keeps. The client says *"this is stale now"* explicitly with [`invalidate`](#invalidate--invalidateall); it never says *"consider it stale after 30 seconds"*. |
| `gcTime` | Retention follows the payload, not a timer — see [what seeding decides](#what-seeding-decides). |
| `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` | Each is a freshness policy in trigger form, and would re-render the owner's whole route on a tab switch. |
| `loaderMeta` | Nothing here is handed to a loader. |

**Everything the client *can* say about the key, it says the ordinary way.**
`set` / `update` write a value the client is holding (a mutation's own
response); `invalidate` / `remove` say the value is gone; both notify readers
through the channels every other key uses. See
[writing to a published key](#writing-to-a-published-key).

#### What it does while it waits

The promise is settled by being **replaced**. A publication of the same key
overwrites the entry *and* resolves the waiting read with the value it
installed, so a reader suspended on it converges immediately — including one
that has not committed yet, which has no subscription for a notification to
reach.

- **Before the first publication**, a read suspends in silence: boundary
  fallback, no request, and no ask — the payload is already on its way. "Read a
  key some ancestor boundary will publish" is a supported pattern, including
  from a component the publisher cannot pass props to.
- **After the key has held a value and lost it** — `invalidate`, `remove`, or
  the payload being collected — the read asks the owner through the lane's
  [`refresh`](#refresh--the-owner-ask), out of render and once per tick, and
  waits for the publication that answers.
- **On publication**, the wait resolves with the published value, and the
  store's own promise holds the same value. A reader inside a hidden
  `<Activity>` converges the same way when its tree is revealed — and a key
  invalidated while hidden asks nothing until that reveal. See
  [under `<Activity>` and router keep-alive](./consistency.md#activity).
- **After ~10 seconds with no publication**, it rejects with
  [`LaneExternalTimeoutError`](#laneexternaltimeouterror) to your Error
  Boundary, and the entry keeps no cache — the next read is a fresh wait with a
  fresh ask, so an error boundary's retry is a real retry.

**A key holds its latest publication, wherever it is read.** If two routes
publish the same key and the user navigates back to the first, its readers show
the *second* route's value: the reveal adopts the store's current value. That is
correct for genuinely shared data (a session, a workspace); for a value that
belongs to one route, put the route in the key.

#### Gating

`loader: cond ? external : undefined` gates an external read exactly as an absent
client loader does — nothing is stored or awaited while disabled, and the result
widens to [`LaneGatedResult`](#lanegatedresultt).

#### What the result has

The same [`LaneResult<T>`](#laneresultt) a client-owned read returns —
`invalidate` and `startInvalidationTransition` included. `invalidate` on an
external key drops the value and, at the next read of it, asks the owner; a
mounted reader re-reads in its transition and keeps showing what it has until
the publication lands.

The one operation an external read still refuses is `lane.prefetch`, at the type
level and at runtime ([`LaneOwnershipError`](#laneownershiperror)): prefetching
is loader execution, and the only "loader" here is the owner's whole route —
re-rendering it for a key nothing is reading yet is not warming, it is work.

#### `LaneExternalTimeoutError`

```ts
class LaneExternalTimeoutError extends Error {
  readonly key: LaneKey;
  readonly keyId: string; // the serialized key, also in the message
}
```

Thrown into the read (and so to your Error Boundary) when no publication arrives
within 10 seconds. It means one of three things, in order of likelihood: nothing
publishes this key; something publishes it under a *different* key (a filters
object that serializes differently, an id of the wrong type); or the reader is
mounted outside the boundary that publishes it. Compare the serialized key in
the message against what the publisher seeds.

Two runtime behaviors worth knowing:

- **The rejection is reported and dropped.** The readers holding the wait are
  rejected; the entry is then left with no cache, so the next read of it starts
  a fresh wait and a fresh ask instead of being handed the failure again.
- **An errored reader does not heal itself.** React error boundaries stay on
  their error UI once they have caught, so a screen that can hit this error
  needs a reset path (a retry button that remounts the boundary, or a boundary
  keyed on the route). The retry itself will ask and can succeed.

### `useLanesAll(reads, options?)` — a batch read

Read a **dynamic-length** set of reads with one hook and get back a single stable
`Promise.all` of their values. `useLane` calls a fixed set of hooks, so it can't
be called in a loop over a list whose length varies; `useLanesAll` orchestrates
all the reads internally over the same core primitives.

```ts
function useLanesAll<T, C = T>(
  reads: readonly LaneReadSpec<T, C>[],
  options?: LaneUseOptions, // the fallback for what a read does not set
): Promise<LaneRead<T>[]>;
```

A batch is usually derived from a list, which is where
[`laneRead`](#lanereadspec--key--loader-colocation) fits best — the members are
the same read applied to different inputs:

```tsx
const reads = useMemo(() => ids.map(taskLanes.detail), [ids]);

// Suspends until all resolve (they load in parallel); a rejecting *initial* load
// throws to the Error Boundary.
const tasks = use(useLanesAll(reads)).map((read) => read.data);
```

Each member is its own keyed read — independently cached,
deduped, subscribed (focus / reconnect / `refetchOnMount`), and invalidatable,
exactly as if you had called `useLane` for each. Three deliberate simplifications
versus a per-item API:

- **The loader is required.** To leave a read out, omit it from the array — there
  is no per-item gating (that is what `loader: undefined` does on a single
  `useLane`).
- **A member's own options win**; the batch's `options` argument is the fallback
  for what a member does not set. So a read behaves in a batch exactly as it
  would through `useLane`, and a batch-wide policy needs no edit to each member.
  Each option falls back on its own, and "does not set" means *has no value* — an
  option a member leaves `undefined` (`staleTime: props.staleTime` where the prop
  is optional) is unspecified rather than an override, so the batch's value still
  applies.
- **The return is just the promise** — one stable, `use()`-able `Promise.all`,
  not an array of per-item handles.

**Why a single aggregate, not an array of promises.** The one thing a parent
can't easily build itself is a **stable** `Promise.all`: built inline it is a
fresh promise every render (re-suspends) and dead-loops on a rejection (a
suspended component never commits, so a per-render/ref memo keeps resetting).
`useLanesAll` owns that identity and swaps it inside a transition when a member
changes, so a background refresh keeps the previous values on screen.

There is deliberately **no `combine` option** — combine in render from
`use(promise)`. Lane is suspense-based, so an aggregate is all-or-nothing; a
partial combine would need status fields Lane intentionally does not have.

Notes:

- **Each member behaves exactly like `useLane`** — transitions, stale-on-error,
  focus / reconnect, `refetchOnMount`, GC. A batch is N `useLane`s feeding one
  `Promise.all`.
- **Adding a read** subscribes and loads just that read; **removing one**
  unsubscribes it. **Duplicate keys** in one call share a single entry.
- **Invalidation** is by key: `lane.invalidate(key)` for one,
  `lane.invalidateAll(scope)` for a family.

For rendering N *independent* rows (not aggregating), don't use `useLanesAll` at
all — render a child component per row and call `useLane` inside each, so every
row keeps its own Suspense boundary and pending state.

### `useInfiniteLane(read)` — a cursor-paginated list

Read an infinite list as **one key holding the whole accumulated list**, with the
page depth in the value rather than in the key or in component state. It is
`useLane` plus a loader that reads the first page and a `loadMore` that appends
the rest through `update` — no core machinery, nothing an ordinary read does not
already do.

```ts
function useInfiniteLane<P, C>(read: {
  key: LaneKey;
  initialCursor: C;
  fetchPage: (
    cursor: C,
    context: { signal?: AbortSignal; meta: LaneLoaderMeta },
  ) => Promise<P>;
  nextCursor: (page: P, cursor: C) => C | null;
} & LaneUseOptions): {
  promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  loadMore: () => Promise<LaneRead<InfiniteLaneValue<P, C>>> | undefined;
  isInvalidationPending: boolean;
  isBackgroundPending: boolean;
  invalidate: (
    options?: LaneInvalidateOptions,
  ) => Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  startInvalidationTransition: (action: () => unknown) => void;
};
```

#### `infiniteLaneRead(spec)`

The colocated form, `laneRead` for a list: the key, the pagination, and the read
options in one value.

```ts
function infiniteLaneRead<P, C>(
  spec: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneReadSpec<P, C> & { key: LaneKeyOf<InfiniteLaneValue<P, C>> };
// …and the form whose first page the route publishes (see below).
function infiniteLaneRead<P, C>(
  spec: InfiniteLaneExternalReadSpec<P, C>,
): InfiniteLaneExternalReadSpec<P, C> & {
  key: LaneKeyOf<InfiniteLaneValue<P, C>>;
};

type InfiniteLaneReadSpec<P, C> = LaneUseOptions &
  InfiniteLaneOptions<P, C> & { key: LaneKey };

type InfiniteLaneExternalReadSpec<P, C> = Omit<
  InfiniteLaneOptions<P, C>,
  "initialCursor"
> & { key: LaneKey; loader: LaneExternalLoader };
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
lane.invalidate(feedLanes.list(filters).key); // the key travels with it
```

Like `laneRead`, it is identity at runtime; what it buys is that `P` and `C` are
inferred and checked where the list is defined — `nextCursor` must return the
cursor `fetchPage` takes — instead of at each call site. The `key` it hands back
is tagged with the accumulated `InfiniteLaneValue`, so `lane.set` / `lane.update`
through it are checked against the whole list rather than one page.

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
const { promise, loadMore, isInvalidationPending } = useInfiniteLane({
  key: ["feed", filters],
  initialCursor: null as string | null,
  fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
  nextCursor: (page) => page.nextCursor,
});

const { data, error } = use(promise);
const items = data.pages.flatMap((page) => page.items);
```

Two things about this hook are easy to guess wrong.

**A re-read is the first page, not the pages you have.** A load is what fills an
entry holding nothing — a first read, a read after `invalidate`, a read after
collection — and what this list holds when nothing has been loaded is where it
starts. The depth on top of that was `loadMore`'s, and it goes with the value it
was appended to. Reproducing it would mean walking the cursor chain, one
*sequential* request per page (page N+1's cursor does not exist until page N is
back), on a path `refetchOnFocus` and a poll fire too — so it is left to the
caller, who knows what it costs: `invalidate()`, then `loadMore()` for the depth
worth buying back. React Query's `useInfiniteQuery` refetches every loaded page
instead; see [migrating](./migrating.md#step-6--infinite-lists). The transition
still holds the list on screen while the shorter one loads, and a failure keeps
it there with `error`.

**`hasNext` is in the resolved value, not on the hook.** The hook returns a
promise it never resolves, so it cannot know — and keeping the flag next to the
pages it describes is what stops the two disagreeing mid-render. The rule for
this hook: **actions come from the hook, data comes from `use(promise)`.**

Notes:

- **`loadMore` appends one page** through `update`, so the key never changes:
  the reader converges through a transition with the list still on screen, and
  `isInvalidationPending` covers it with no `useTransition` of your own. It is a
  no-op at the end of the list; gate your control on `data.hasNext`.
- **`fetchPage`'s `signal` is optional because it is genuinely absent on the
  append path.** A refresh runs as a read and gets the read's abort signal; an
  updater is handed the current value and no controller, so a `loadMore` in
  flight cannot be aborted.
- **`loadMore`'s identity follows `fetchPage` / `nextCursor`** (a `useCallback`
  over those plus the lane and serialized key) — stable exactly when the
  caller's functions are. Driving it from an effect (a scroll sentinel) is the
  caller's `useEffectEvent`.
- **An auto-load trigger must also gate on `error`.** A failed append changes
  neither the rows nor `hasNext`, so a scroll sentinel fires again, forever,
  against a server that is already failing. Gate on all three facts, which is
  why they arrive together:

  ```tsx
  const { data, error } = use(promise);
  // ...inside the IntersectionObserver effect:
  if (!data.hasNext || isInvalidationPending || error) return;
  ```

  `error` clears on the next successful read, so recovery is an explicit retry —
  a button calling `loadMore` again. A caller can also await `loadMore`: it
  hands back the entry's next promise, which *resolves* with `error` set rather
  than rejecting.
- **Depth is as durable as the value.** Remounting reuses the cached value (no
  request) and the depth comes back with it; anything that clears the value —
  `invalidate`, `remove`, collection — takes the depth with it, and the next
  read starts where the list starts.

#### The first page from the route

A list on a server-rendered route usually has one page already: the route loaded
it. `loader: external` says so — **the first page belongs to the route, the
depth belongs to the browser**, on one key:

```ts
export const feedLanes = {
  list: (filters: Filters) =>
    infiniteLaneRead<Post, Cursor>({
      key: ["feed", filters],
      loader: external,        // page 1 is published; no client first load
      fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
      nextCursor: (page) => page.nextCursor,
    }),
};
```

No `initialCursor` — the published value carries the cursor page 1 was fetched
with — and no `staleTime` / `refetchOn*`, exactly as on
[`external`](#external--a-read-the-owner-publishes): freshness is the owner's.
`fetchPage` and `nextCursor` stay required, because `loadMore` is still the
browser's. Everything else is unchanged: `loadMore` appends through `update`
(and the appended list takes the publication's seat, so it lives as long as the
payload), and `invalidate` asks the owner through
[`refresh`](#refresh--the-owner-ask).

**`infiniteLaneSnapshot` is where a page becomes the list.** The key holds
`{ pages, params, hasNext }` whoever filled it, so the route publishes that
shape — and this helper is the only place the conversion happens. The store
stores what it is handed and the read reads what is stored; a conversion
anywhere else would be a second answer to "what is under this key".

```ts
// page.tsx — a Server Component. Isomorphic, like `laneSnapshot`.
import { infiniteLaneSnapshot } from "use-lane";

const snapshots = {
  entries: [infiniteLaneSnapshot(feedLanes.list(filters), firstPage, null)],
};
// ≡ laneSnapshot(read, { pages: [firstPage], params: [null],
//                       hasNext: read.nextCursor(firstPage, null) !== null })
```

**A publication replaces the key.** A route republishes page 1 on every
navigation and every `refresh`, and what it publishes is what the key holds —
one page, however deep the list on screen was a moment before. The store never
compares a publication with what it is standing on, and there is no depth it
carries over.

Not comparing is the rule, not an omission. A page 1 deep-equal to the one
already there is no evidence that nothing happened to the list: a row can be
edited and edited back, a page deleted and restored, between two publications.
Equality would be the store guessing at a history it cannot see. A publication
is the owner's whole answer for that key, so Lane takes it whole.

**The browser keeps its depth by not having the route render again.** Depth
survives for exactly as long as nothing republishes the key — a `set` or an
`update` converging the row a mutation just confirmed, a navigation that leaves
this route standing, anything at all that does not reach the route.

That is the lever, and it is the one to reach for: on a screen whose list depth
matters, converge derived data from the mutation's own response with `set`
rather than marking it stale with `invalidate`. An `invalidate` of *any* key the
route owns is answered by [`refresh`](#refresh--the-owner-ask), and a route that
renders again republishes everything it publishes — this list included, at page
1. The list's depth is not what makes an `invalidate` reach it; the route is.

`invalidate` on the list itself discards the depth by design: saying "this key
is stale" says it about pages 2..n too, and they cannot be re-derived without
walking the cursor chain again. The owner answers with page 1, and the list
starts again there — as it does for a publication that lands while the reader
is hidden in an [`<Activity>`](./consistency.md#activity), or one that lands
before `loadMore`'s page has arrived. There is one rule, and no window in which
a different one applies.

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
  const { promise } = useLane({
    key: ["component-graph", selectedId],
    loader: ({ signal }) => fetchComponentGraph(selectedId, signal),
  });

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
  promise, so the fetch is in flight before the transition, and the entry is
  subscribed from mount.
- **Reveal gated, not the loader.** `if (!reveal)` returns before `use`, so the
  first render commits the placeholder without suspending.
- **Flip inside a transition.** A plain `setReveal(true)` would suspend as a
  non-transition update and replace the placeholder with the nearest Suspense
  fallback. The transition keeps the current UI until ready; drive a loading
  affordance off `isPending`.

With multiple deferred reads, every loader is set unconditionally, so all
fetches start in parallel on mount; how they *reveal* is set by how you gate the
`use()` calls. One gate reveals them together (transitions that suspend at the
same time commit together); staggered gates reveal fast data first. Data you
don't integrate at all is simpler read in its own `<Suspense>` boundary.

Caveats:

- **Keep a `<Suspense>` boundary above** as the backstop.
- **This defers the reveal, not the key change.** When `selectedId` changes, the
  key switch suspends and reveals the fallback again — wrap the state change
  that drives the key in a transition too (see
  [Transitions](./integrations.md#transitions-and-the-backforward-caveat)).
- This **always fetches**. When a read may genuinely never be needed, gate the
  *loader* instead (`loader: undefined`) — see
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
prefetch<T, C = T>(read: LaneReadSpec<T, C>): Promise<LaneRead<T>>;

// When LaneRegister declares a loaderMeta, it is required here — this is the
// one read that happens outside React, so it cannot take it from the provider.
prefetch<T, C = T>(
  read: LaneReadSpec<T, C>,
  options: { loaderMeta: LaneRegister["loaderMeta"] },
): Promise<LaneRead<T>>;
```

`prefetch` uses the read's key, loader, and `loaderMeta` — the things running one
needs — plus its `warmTime` (warming is a bet on an arrival, and this is where
the bet is placed) and its `fallback` (which describes the load, so a warmed key
that failed holds what the eventual reader would have gotten). Everything else on
the read describes what a *reader* does with the value (`staleTime` / `gcTime` /
`refetchOn*`), and warming is not the read, so those stay the eventual reader's
call.

It refuses an [`external`](#external--a-read-the-owner-publishes) read, at the
type level and at runtime
([`LaneOwnershipError`](#laneownershiperror)) — that read's loader is the
owner's route, and re-rendering it for a key nothing reads yet is work, not
warming.

`prefetch` is a method on the
[`Lane` instance](#mutation-convergence--the-lane-instance)
(`useLaneInstance().prefetch(...)`). The canonical use is intent-driven warming —
hover (and `focus`, for keyboard users) over a link to warm the destination's
data before navigation:

```tsx
const lane = useLaneInstance();
const warm = () =>
  lane.prefetch({
    key: ["component-graph", id],
    loader: ({ signal }) => fetchComponentGraph(id, signal),
  });

<Link href={`/component/${id}`} onMouseEnter={warm} onFocus={warm} />;
```

- **Deduped.** A repeat `prefetch` of the same key (a re-fired hover) reuses the
  cached promise — the loader runs once. A prefetch never discards an in-flight
  or settled cache.
- **Not subscribed.** A prefetched entry has no reader, so it does not revalidate
  on focus, or anchor against GC. If no reader adopts it, it is an orphan
  reclaimed by the lane's sweep (within `warmTime`); if a reader mounts first, the
  entry becomes live and is kept.
- **Freshness is the reader's call.** `prefetch` only warms; `staleTime` /
  `gcTime` are decided by the eventual `useLane`. A
  [spec](#lanereadspec--key--loader-colocation) is warmed the same way — its
  freshness options are left to the reader, so
  `lane.prefetch(taskLanes.detail(id))` is the whole hover handler. This is the
  one instance method that takes a read rather than a key, because warming means
  running the loader.

The returned `Promise<LaneRead<T>>` is the warmed promise — usually ignored, but
available to `await` if you want to sequence work after the warm-up. A rejected
prefetch that nobody consumes does not surface as an unhandled rejection.

### `LaneUseOptions`

```ts
type LaneUseOptions = {
  loaderMeta?: LaneRegister["loaderMeta"];
  staleTime?: number;
  gcTime?: number;
  warmTime?: number;
  refetchOnFocus?: boolean;
  refetchOnMount?: boolean;
  refetchOnReconnect?: boolean;
};
```

> `gcTime` and `warmTime` take the lane's value when a read does not set one.

| Option | Default | Description |
| --- | --- | --- |
| `loaderMeta` | the lane's | Read this entry with a different `meta` than the lane carries — see [`LaneRegister`](#laneregister--what-loaders-are-handed-besides-the-key). Not part of the key. In a batch, a member's own value wins over the batch's. |
| `staleTime` | `Infinity` | How long (ms) a fulfilled value is considered fresh. Once stale, the entry becomes eligible for `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` reloads — which refresh what a reader is showing rather than taking it away. The default means **nothing is ever stale until you say what stale means** — so all three revalidation triggers do nothing without a `staleTime`, and warn in development. `staleTime` is also the rate limit on the triggers it gates: a value refreshed within it is not refreshed again however many times they fire. `staleTime: 0` asks for "always stale", which includes a mount refetching the value that same mount just loaded — the read runs during render and the trigger fires from an effect, so the two stack. |
| `gcTime` | the lane's | How long (ms) **this read's** value is worth keeping once nothing holds it — this read's override of [`createLane`](#createlaneoptions)'s, and the way to say "do not serve this again after I leave". `0` makes every remount a fresh load; `Infinity` keeps it. For an *idle* entry, "worth keeping" and "worth serving again" are the same question, which is why the load a remount starts after the deadline **suspends**: the entry is gone, so the wait joins whatever transition the remount is part of. The deadline is set when the entry goes idle, from the `gcTime` of whoever held it last; eviction is never synchronous, so an unsubscribe and a resubscribe in one task (StrictMode's double invoke, a re-suspension) collect nothing. |
| `warmTime` | the lane's | How long **this read's** value is kept for a reader who has *not arrived yet*, measured from the moment it settles: a value warmed by [`prefetch`](#prefetch) that nobody has read, or an entry created by a render that suspended and unmounted before it could commit. Deliberately not `gcTime` — that answers "somebody had this and left; how long is it worth keeping for their return". **The clock never runs while the read is in flight** — collecting an in-flight read would abort a load a suspended render may still be waiting on. |
| `refetchOnFocus` | `false` | Reloads stale entries on window focus. Needs a `staleTime` to fire at all — with the `Infinity` default nothing is stale, and Lane warns in development. |
| `refetchOnMount` | `false` | Reloads stale entries when a reader mounts. Needs a `staleTime` to fire at all. `staleTime: 0` makes it fire on every mount — including the mount that just loaded the value, since the read runs during render and this fires from an effect. |
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
  // The trailing argument is required exactly when `LaneRegister` declares a
  // `loaderMeta` — this read happens outside React, so it cannot take the
  // provider's. See `prefetch` under Reading data.
  prefetch<T, C = T>(read: LaneReadSpec<T, C>, ...args: LaneLoaderMetaArgs): Promise<LaneRead<T>>;
  // Opens the *readers'* transitions in a scope. Call it inside an action that
  // is already running in one — see `startInvalidationTransition` above.
  startInvalidationTransition(scope: LaneScope): void;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  // A `LaneKeyOf<T>` decides the value's type; a plain key lets the value decide it.
  set<T>(key: LaneKeyOf<T>, valueOrPromise: T | Promise<T>): Promise<LaneRead<T>>;
  set<T>(key: LanePlainKey, valueOrPromise: T | Promise<T>): Promise<LaneRead<T>>;
  update<T>(key: LaneKeyOf<T>, updater: LaneUpdater<T>): Promise<LaneRead<T>> | undefined;
  update<T>(key: LanePlainKey, updater: LaneUpdater<T>): Promise<LaneRead<T>> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<LaneRead<T>>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
  cancel(key: LaneKey): void;
};
```

Every method here addresses **entries**, so every one of them takes a key — a
plain array, or a [`LaneKeyOf`](#lanekeyoft--a-key-that-knows-what-it-holds) when
you want the value checked:

```ts
lane.invalidate(["task", id]);
lane.invalidate(taskLanes.detail(id).key); // same entry, one definition
lane.set(taskKeys.detail(saved.id), saved); // checked against what the key holds
```

`prefetch` is the exception and takes a whole read, because it is the only method
that *performs* one.

**Nothing here reads.** Every method returns a promise or `void` — there is no
`get` / `peek` / `getQueryData` equivalent, and no way to ask what a key
currently holds. Values reach components through `use(promise)` and nowhere else.
See [the store returns promises, never
data](./design-notes.md#the-store-returns-promises-never-data) for the reasoning,
and [there is no cache getter](./migrating.md#there-is-no-cache-getter) for where
each react-query `getQueryData` use goes instead.

> **These work on every entry, published or not.** `set`, `update`, `updateAll`,
> `invalidate`, `invalidateAll`, `remove`, `removeAll` and
> `startInvalidationTransition` do the same thing to a key read with
> [`external`](#external--a-read-the-owner-publishes) as to one the client
> loads; what differs is who answers an invalidation — for a published key,
> the owner, asked through [`refresh`](#refresh--the-owner-ask). `prefetch` is
> the exception and throws
> [`LaneOwnershipError`](#laneownershiperror) on an external read, because it is
> the one method that runs a loader. See
> [writing to a published key](#writing-to-a-published-key).

### `LaneReadError`

```ts
class LaneReadError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;
  // `cause` is the loader's own error
}
```

What a failed read throws — the loader's error wrapped in one that says *which
key* failed. Only a load with nothing to show throws at all; a failure over
existing data resolves `{ data, error }` instead, and that field carries the
loader's error **unwrapped**.

The wrapper exists because of what a throw destroys. In the common shape —
`useLane` and `use()` in one component, under the boundary — the reader that
suspended is also the only thing holding the key, so its subscription and the
`invalidate` the hook handed it go with it. The error is the one artifact that
crosses the boundary from a reader that no longer exists, which makes it the
only thing that can carry the key out:

```tsx
function Fallback({ error, clear }: { error: unknown; clear: () => void }) {
  const lane = useLaneInstance();

  if (!(error instanceof LaneReadError)) {
    throw error;   // not ours to recover
  }

  return (
    <button onClick={() => { lane.invalidate(error.key); clear(); }}>
      Retry
    </button>
  );
}
```

That is a boundary that recovers a read without being told what it reads. For a
subtree with several failed keys — one boundary catches only the first throw —
`lane.invalidateAll(scope, { onlyIf: "rejected" })` is the same recovery without
naming a key at all.

Neither the lane instance nor a `retry()` method is carried here. The lane is a
context read away for anything that can call a hook (a fallback is a component),
and a method would have to answer questions the error has no business answering:
invalidate or remove, and whether it also clears the boundary's own state. A key
answers nothing and composes with everything.

**A published key's failure is not wrapped.** The client did not start that
load, and the failure it can get —
[`LaneExternalTimeoutError`](#laneexternaltimeouterror) — already carries the
same `key` for identification, so wrapping would only add a layer to unwrap.
Recovery is a re-read: the entry keeps no cache after a timeout, so remounting
the boundary starts a fresh wait and a fresh ask.

**It does not survive the server.** React replaces an error thrown while
rendering on the server with a digest before the client sees it, so a fallback
recovering by `error.key` recovers from client-side failures only. A read that
failed during SSR reaches the browser as an ordinary error.

#### Why a rejection is never retried by a read

A cached rejection is served to every later read of the key until the key is
invalidated, removed, or collected. Retrying is an event; a render is not one —
React renders a suspended reader as many times as it likes and throws the work
away, so a retry decided during a read would fire on every attempt and the
failure would never reach the boundary. Recovery is always something that
*happens*: an `invalidate`, a `remove`, a revalidation trigger firing from an
effect, or garbage collection. Reads only read.

### `LaneOwnershipError`

```ts
class LaneOwnershipError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;
}
```

Thrown synchronously — in production as well as development — by
[`lane.prefetch`](#prefetch) on an [`external`](#external--a-read-the-owner-publishes)
read. That is the only operation it is left for: every other client operation
(`set`, `update`, `updateAll`, `invalidate`, `invalidateAll`, `remove`,
`removeAll`, `startInvalidationTransition`) works on an external entry exactly
as on a client-owned one.

The message names the serialized key and the operation. What it refuses is not a
write but a *load*: `prefetch` runs a loader, and the loader of an external key
is the owner's whole route. Warming one key that way is a route re-render for
something nothing is reading yet. Let the read ask instead — a reader that
needs the value asks through [`refresh`](#refresh--the-owner-ask), and a reader
that does not, does not.

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
  onlyIf?: "stale" | "settled" | "rejected";
  staleTime?: number;
  background?: boolean;
};
```

- omit `onlyIf` → always invalidate.
- `"stale"` → only fulfilled entries older than `staleTime`. With no `staleTime`
  the default (`Infinity`) applies and nothing matches; a rejected entry is never
  stale either, so a failed *first* load is not retried this way (`"settled"` does
  retry it, and a failed load over data keeps the previous value, which stays as old as
  it was and so is still eligible).
- `"settled"` → only entries with a settled promise (skips in-flight reads).
- `"rejected"` → only entries whose last read failed **with nothing to show** —
  exactly the keys whose readers are sitting in an Error Boundary. Stale-on-error
  records the fallback's settlement, so a key still serving data is not one of
  these however its last load went, and in-flight reads are excluded as above.
  That is what makes `lane.invalidateAll(scope, { onlyIf: "rejected" })` safe to
  fire at a whole subtree: it retries what is broken and cannot disturb what is
  on screen. It is the blunt companion to [`LaneReadError`](#lanereaderror)'s
  `key` — one boundary catches one throw, so a subtree with several failed keys
  needs a way to say "retry what is broken" without naming any of them.
- `background: true` → converge through the **background** transition
  (`isBackgroundPending`) instead of the default explicit one
  (`isInvalidationPending`). Use it for automatic refreshes so they don't read as a
  user-driven invalidation — see [Polling](#polling).

### Polling

Lane has no `refetchInterval` option: polling is just a self-scheduled
invalidation, written with primitives (the same stance as mutations). Because a
component only commits *after* `use(promise)` resolves, an effect that reschedules
after each load never fires mid-flight:

```tsx
function Polled({ id }: { id: string }) {
  const { promise } = useLane({
    key: ["task", id],
    loader: ({ signal }) => fetchTask(id, signal),
  });
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

- **`background: true`** keeps the refresh off `isInvalidationPending` (it surfaces
  as `isBackgroundPending`), so an automatic poll doesn't read like a user action.
- Depending on `[promise]` makes it a **poll-after-response** loop (a fixed gap
  after each load). For a fixed **wall-clock** interval, use `setInterval` plus
  `{ onlyIf: "settled" }` so a tick during an in-flight read is skipped instead of
  aborting it.
- **Keep the schedule off the render path.** Don't put the key *array* in the
  effect's dependency list — it is a fresh reference every render, so the timer
  is torn down and recreated each render and may never fire. The simplest fix is
  the bound `invalidate` from `useLane`: it accepts the same options, is
  addressed to the read's key, and is stable across renders — depend on it
  directly:
  ```tsx
  const { promise, invalidate } = useLane(taskLanes.detail(id));
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

Publishing to a [`LaneKeyOf`](#lanekeyoft--a-key-that-knows-what-it-holds) is
type-checked — the key carries what its entry holds, so the value has to be that:

```ts
lane.set(taskKeys.detail(saved.id), saved);
// @ts-expect-error — not what this key holds
lane.set(taskKeys.detail(saved.id), { title: saved.title });
```

A plain key carries no type, so the value decides it, exactly as before.

`set` is **not** an optimistic-update mechanism. Optimistic state belongs in
component-local `useOptimistic`.

On a [published](#external--a-read-the-owner-publishes) key it is the same
write, and the entry stays external — [retention](#external-retention)
included: the write takes the place of the value it overwrote, so it lives
exactly as long as that publication would have and goes when the framework drops
the payload. The next read then asks the owner, the same recovery as for a
collected publication.

### `update` / `updateAll`

Derive the next value from the current one. Fulfilled entries update
immediately; pending entries chain the updater onto the in-flight promise;
rejected or missing entries are left unchanged (`update` returns `undefined`).
`update` adopts the in-flight result, so it does **not** abort the read.

```ts
type LaneUpdater<T> = (current: T, entry: LaneEntryInfo) => T | Promise<T>;

lane.update<Task>(["task", id], (task) => ({ ...task, done: true }));
lane.updateAll<Task[]>(["tasks"], (list) => list.filter((t) => t.id !== id));

// Through a typed key, `current` comes from the key — no type argument.
lane.update(taskKeys.detail(id), (task) => ({ ...task, done: true }));
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
next read fails, nor the next loader's [`current`](#uselaneread).
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

There is no `cancelAll`, and `useLane` returns no bound `cancel`: on a key with
nothing to revert to a cancel leaves a rejection, so applying it to an
unenumerated family would leave one on an unknown number of keys — and stopping
a read is rare enough that a bound form would be dead weight in every reader's
result.

**Only cancel a read you started and can still account for.** Two conditions,
both about the call site rather than about the cache:

1. **You issued this read** — your own `invalidate`, a load you are explicitly
   offering the user a way to stop, a key whose parameters are spent.
2. **Nothing else reads this key** — cancelling is addressed by key, so on a
   shared key one call stops your refresh *and* someone else's first load.

A read left behind by a superseded transition — switching tabs, retyping a
search — fails the first, and is the one place not to reach for this. See
[Cancelling is for reads you own](./design-notes.md#cancelling-is-for-reads-you-own).

Where the key lands is decided by what it already had:

| Key holds | Result |
| --- | --- |
| a last fulfilled value | reverts to it — readers keep showing their data, and **no `error`**, since the caller asked for the stop |
| nothing to revert to | the read settles **rejected** — the only end a transition holding no data can reach |

The rejection is then as sticky as any other failed first load: it is reused until
the key is invalidated, removed, or collected.
An Error Boundary reset alone re-reads the same rejected promise, so pair a retry
with an `invalidate`. That is deliberately not special-cased — a cancelled first
load recovers the way every other one does.

Cancelling holds whether or not the loader forwards its `signal`: a loader that
drops it runs to completion, but its result is not adopted. Forwarding it is still
what makes the request actually stop — see
[Don't drop the abort signal](./common-mistakes.md#dont-drop-the-abort-signal).

## Hydration (RSC seeding)

**Nothing here is server-specific.** `LaneHydration` applies a payload of
snapshots to a lane; where the payload came from is the publisher's business. An
RSC route's props are one source, a client router's loader data is another — the
demo's `/lane-router` publishes from React Router loaders with no server involved,
and the semantics are identical: the loader owns the data, Lane distributes it,
and the client reads it with [`external`](#external--a-read-the-owner-publishes).
See [Data mode](./integrations.md#data-mode--loaders-publish-into-lane).

It is not client-specific either: during streaming SSR the publication runs on
the server, and an `external` reader elsewhere in the tree — even outside the
boundary — suspends and resolves inside the same server render. Which is why the
lane must be **per request** on the server: let `LaneProvider` create it (the
default). A module-scoped lane shared across requests would leak one request's
publications into another's render.

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
repeated provider renders and Strict Mode do not re-seed. Identity is what that
promise is keyed on, which has a corollary worth stating plainly:

> **`snapshots` must be produced outside render** — one object per data payload.
> A Server Component's props satisfy this, and so does a router loader's data
> ([React Router / TanStack](./integrations.md#data-mode--loaders-publish-into-lane)):
> both hand back the same object across re-renders and a new one when the data
> reloads, which is exactly when re-seeding is wanted.
>
> What breaks is building it *inside* a render —
> `<LaneHydration snapshots={buildSnapshots(seeds)}>` in a component body hands
> over a new object every render, so every render suspends on a fresh hydration
> promise and the boundary never commits. If the assembly has to happen in a
> component, `useMemo` it on the source data.

Build the snapshots on the server from the same keys your hooks use:

```ts
const snapshots: LaneHydrationSnapshots = {
  entries: [
    { key: ["current-user"], data: currentUser },
    { key: ["tasks", filters], data: tasks },
  ],
};
```

The *same keys* can be the same code: [`laneKey`](#lanekeyoft--a-key-that-knows-what-it-holds)
and [`laneRead`](#lanereadspec--key--loader-colocation) are importable from a
Server Component — only the modules that touch React carry `"use client"` — so
the key module your hooks import serves the seed path too.

#### `laneSnapshot(readOrKey, data)`

An object literal lets any `data` through, because `LaneSnapshot.key` is a plain
`LaneKey`. That matters more here than almost anywhere else: a mismatched pair
does not fail a fetch, it seeds every reader of that key with the wrong shape and
surfaces somewhere else entirely. `laneSnapshot` infers `T` from the key and
checks `data` against it.

```ts
function laneSnapshot<T>(
  target: LaneKeyOf<T> | { key: LaneKeyOf<T> },
  data: T,
): LaneSnapshot<T>;
function laneSnapshot<T>(target: LanePlainKey, data: T): LaneSnapshot<T>;
```

It takes a **read**, not just a key — anything with a `key`, including an
[infinite read](#useinfinitelaneread--a-cursor-paginated-list) — so the seed is
written against the same definition the browser reads with:

```ts
// page.tsx — a Server Component. No loader is called; a read is a plain object.
const snapshots = {
  entries: [
    laneSnapshot(taskLanes.list(filters), tasks),
    laneSnapshot(taskLanes.detail(id), task),
  ],
};
```

A plain key carries no type, so — exactly as with [`set`](#set) — the value
decides it, and `laneSnapshot(["tasks", filters], tasks)` keeps working.

#### `infiniteLaneSnapshot(read, firstPage, initialCursor)`

An infinite key holds the accumulated list, so publishing its first page means
publishing that shape. This builds it — the one place a page becomes a list; see
[the first page from the route](#the-first-page-from-the-route).

```ts
function infiniteLaneSnapshot<P, C>(
  read: {
    key: LaneKeyOf<InfiniteLaneValue<P, C>>;
    nextCursor: (page: P, cursor: C) => C | null;
  },
  firstPage: P,
  initialCursor: C,
): LaneSnapshot<InfiniteLaneValue<P, C>>;
```

`hasNext` comes from the read's own `nextCursor`, so the route and the browser
agree about whether there is more before a single client fetch has run. Like
`laneSnapshot` it calls no loader and touches no React — it lives in the same
Server-Component-safe module.

#### What seeding decides

**Everything a publication seeds becomes an external entry**, and stays one for
as long as the shell lives. Three things follow, and only three:

- **Freshness is the owner's.** The read carries no `staleTime` and no
  `refetchOn*` — see [`external`](#external--a-read-the-owner-publishes).
- **Retention follows the payload, not `gcTime`.** The value is held weakly and
  kept alive by the publisher's payload object and by every committed reader,
  so it lives exactly as long as the framework keeps the payload — and so does a
  client write onto the key, which takes the place of the value it overwrote
  (see [retention](#external-retention)). The shell —
  and with it the fact that an owner fills this key — outlives the value, so a
  later read knows to ask rather than to wait in silence.
- **`prefetch` is refused.** There is no loader here but the owner's route; see
  [`LaneOwnershipError`](#laneownershiperror).

What does *not* follow is a closed write side. `set`, `update`, `invalidate`,
and `remove` all work on a seeded key — see
[writing to a published key](#writing-to-a-published-key).

Reading a seeded key with a *client* loader is still a mistake, and warns in
development: two loaders for one key means whichever ran last decides what is
stored, with none of a client-owned entry's guarantees behind it. Read it with
`external`, or stop seeding it.

### Writing to a published key

A client write to a published key is not a fork of the truth. It states what the
client has just confirmed — a mutation's own response — and the next publication
states at least as much. So the channel is the ordinary one:

| The client… | Does |
| --- | --- |
| has the new value (the mutation returned it) | `lane.set(key, value)` / `lane.update(key, fn)` — lands with no round trip and no fallback, visible or hidden |
| knows a key is now wrong but not what it should be (counts, insights, a re-sorted list) | `lane.invalidate(key)` — the value goes, and the next reader to need it asks the owner through [`refresh`](#refresh--the-owner-ask) |
| wants the owner's whole answer | mutate the source and revalidate; the payload re-streams and republishes |

```ts
// A Route Handler mutation: the response is the new task.
const task = await updateTask(id, input);

lane.set(taskLanes.detail(id).key, task);          // exact, in place
lane.update(taskLanes.list(filters).key, (tasks) =>  // exact, in place
  tasks.map((row) => (row.id === task.id ? task : row)),
);
lane.invalidate(insightLanes.summary().key);       // derived — ask the owner
```

```ts
// A Server Action that revalidates: the response already carries the re-rendered
// route, so the publication is the convergence. Nothing to do on the Lane side.
"use server";

export async function updateTaskAction(id: string, input: UpdateTaskInput) {
  const task = await db.updateTask(id, input);
  revalidatePath("/tasks"); // the route republishes; every seeded key updates
  return task;
}
```

Which to use is not a matter of taste — see
[the two mutation channels](./integrations.md#the-two-mutation-channels) for the
behavioural differences (one round trip vs. parallelism, and what a revalidating
Server Action always re-renders).

**`update` needs a current value; `set` and `invalidate` do not.** An updater
is handed what the key holds, so on an entry that holds nothing — never
published, invalidated, or collected because its payload and every reader were
gone ([retention](#external-retention)) — `update` returns `undefined` and the
updater does not run. That is the ordinary `update` contract, and it is where a
screen that is *not on display* differs from the one you are looking at: the
visible screen's readers hold the value, so it is there to update; a screen
that has left the router's keep-alive may or may not still have it, depending
on whether the router still holds its payload. So for a key no reader is
showing, say what you know in a form that does not need a current value —
`set(key, value)` when you have the value, `invalidate(key)` when you do not
(the shell it marks is never collected, so the mark is always there for the
reveal to find) — and treat `update` as best-effort: where it finds nothing,
the next reveal reads the owner's version, which has the mutation in it anyway.
The difference is only whether the screen comes back instantly or through one
fallback.

In a client router the revalidation channel is the router's own — see
[Data mode](./integrations.md#data-mode--loaders-publish-into-lane).

What that buys is agreement: one publication updates the entity, every list it
appears in, and every count derived from it, because one source read produced
them all. What it costs is the round trip, and the answer to that is
**`useOptimistic` over the read value** — display state that belongs to the
action, not a write to a key you do not own:

```tsx
const { data: task } = use(promise);
const [optimistic, addOptimistic] = useOptimistic(task, applyChange);

async function changeStatus(status: Status) {
  startTransition(async () => {
    addOptimistic({ status });     // immediate, local to this component
    await updateTaskAction(id, { status }); // the republication is the truth
  });
}
```

Two things to keep apart, because both look like the same tool:
**`lane.set` is for a value you have**, never for a guess — it publishes to
every reader of the key with no rollback, which is right for a mutation's
response and wrong for optimism (`useOptimistic` is local to the component and
reverts itself). And **`lane.invalidate` after a revalidating Server Action** is
redundant rather than wrong: the action's own response already carries the
re-rendered route, so the publication is on its way and the invalidation only
adds an ask for a payload already in flight.

## Lifecycle behavior

- **Falling back.** <a id="stale-on-error"></a> A failed load does not reject
  outright if there is something to serve in its place. By default that is the
  **last fulfilled value**: an entry that already has one keeps resolving with it
  when its next read rejects (after invalidation, focus refetch, or a `set` of a
  rejecting promise), and the failure surfaces as [`error`](#lanereadt) beside
  the data. Freshness keeps the original fulfillment time, so staleness policies
  still treat the data as old and retry. Only a load with nothing to serve — no
  previous value, and no [`fallback`](#fallback--what-a-read-serves-when-its-load-fails)
  that returned one — rejects the promise and reaches the Error Boundary.
- **The last fulfilled value.** One value per entry backs both the fallback
  above and the [`current`](#uselaneread) a loader is
  handed. It outlives invalidation (which clears the cached promise, not the
  value) and is dropped by [`remove`](#remove--removeall), by garbage collection,
  and by an invalidation of an entry no reader is holding — that last one deletes
  the entry outright, since it has neither a cache nor a subscriber left.
- **Stale reads.** A read never takes a value away — not for staleness, not for a
  prior error ([`LaneReadError`](#lanereaderror) says why). `staleTime` sets how
  long a value stays fresh, and what acts on that is `refetchOnMount` /
  `refetchOnFocus` / `refetchOnReconnect`, firing from an effect to refresh what
  a reader is showing *underneath* it. What a remount is served instead is decided
  by whether the entry survived: see `gcTime` above.
- **Abort.** Loaders receive an `AbortSignal` that fires when the read is
  discarded by invalidation, removal, an authoritative `set` over a pending read,
  or GC.
- **Structural sharing.** <a id="structural-sharing"></a> When a reload
  resolves with data deeply equal to the previous value, previous references are
  reused so memoized consumers do not re-render. This is a guarantee, not just
  an optimization: one settlement's `data` is `===` to the previous one's
  exactly when the content is deep-equal, so a reference comparison between two
  reads you hold is a precise change check — and [`revision`](#lanereadt) is the
  same fact as a serializable number, for the places a reference cannot go.
  (The domain is plain objects, arrays, and primitives; a class instance or
  `Date` in the data always comes back as a new reference.)
- **Polling.** Not a built-in — schedule your own timer and call
  `invalidate(key, { background: true })`. See [Polling](#polling).
- **Focus / reconnect.** The provider coalesces `focus` + `visibilitychange`
  into one revalidation per `focusThrottleInterval` (default 5s); `online` drives
  reconnect revalidation (not throttled).
- **Garbage collection.** An inactive entry (no subscribers) is retained for its
  `gcTime` — the departing reader's, or the lane's default (`createLane({ gcTime })`,
  default 5 min; `Infinity` opts out) — and then collected. Collection is a
  single coalesced sweep per lane, armed for the nearest deadline; it is never
  synchronous, so an unsubscribe and resubscribe within one task (StrictMode,
  a re-suspension) collect nothing. An entry that settled with **no reader ever**
  (a prefetch nobody adopted, a render that never committed) is reclaimed on the
  shorter `warmTime` instead.
- **Retention of published entries.** <a id="external-retention"></a> An
  [external](#external--a-read-the-owner-publishes) entry is **exempt from
  `gcTime`** — Lane does not time out a value it did not fetch. It holds the
  value weakly instead, so it lives exactly as long as something else keeps it
  reachable: the publisher's payload (the snapshots object is tethered to what
  it published) or any committed reader — including one inside a hidden
  `<Activity>`, which is [why keep-alive needs no `gcTime`
  tuning](./consistency.md#activity). A key whose payload *and* readers are both
  gone reads as absent, and its next read waits — and asks the owner through
  [`refresh`](#refresh--the-owner-ask), because the shell remembers that this
  key was filled once. A **client write** onto such a key — `set`, `update`, an
  appended page — shares that retention: it takes the place of the value it
  overwrote among the payload's references, so it lives exactly as long as the
  publication it replaced would have. Nothing is pinned and `gcTime` still says
  nothing about the key; drop the payload and the client's version of the value
  goes with the server's, together. The edge is a write that lands when the
  payload is *already* gone: there is nothing to take the place of, so it is
  held by its readers alone and can be collected with them — the next read waits
  and asks the owner, the same recovery as for a collected publication, and the
  state the owner is in anyway. "Its readers" means the readers that have
  *adopted* it: a reader keeps alive the promise it rendered, and a reader in a
  hidden `<Activity>` adopts nothing until its reveal, so a write made while a
  screen is hidden lives with the payload — or, if that is gone, with no one —
  until the screen comes back. A visible reader adopts in the transition the
  write opens, so on the screen you are looking at the new value is held the
  moment it lands. The **shell** is what is never collected:
  `invalidate`, `remove`, and the sweep all leave it standing, so a key that has
  been published stays a key an owner fills. Client-owned entries are untouched
  by any of this.

## Type exports

`InfiniteLaneExternalReadSpec`, `InfiniteLaneOptions`, `InfiniteLaneReadSpec`, `InfiniteLaneResult`, `InfiniteLaneValue`,
`Lane`, `LaneClientLoader`, `LaneEntryInfo`, `LaneEventSource`, `LaneExternalLoader`, `LaneExternalReadSpec`, `LaneFallback`, `LaneGatedExternalReadSpec`, `LaneGatedReadSpec`, `LaneGatedResult`, `LaneHydrationSnapshots`, `LaneInvalidate`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneLoaderMeta`, `LaneLoaderMetaArgs`, `LaneLoaderMetaProp`, `LaneOptions`,
`LaneKeyOf`, `LanePlainKey`, `LaneProviderProps`, `LaneRead`, `LaneReadSpec`, `LaneRefetchOnFocus`, `LaneRefetchOnMount`, `LaneRefetchOnReconnect`, `LaneRegister`,
`LaneResult`, `LaneRevalidateHandlers`,
`LaneScope`, `LaneSnapshot`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`,
`ReactNativeAppState`, `ReactNativeEventSourceOptions`, `ReactNativeNetInfo`.

Runtime exports beyond the hooks and `createLane`: `external` (see
[`external`](#external--a-read-the-owner-publishes)), `LaneExternalTimeoutError`,
`LaneOwnershipError`, `LaneReadError`, `laneRead`,
`infiniteLaneRead`, `infiniteLaneSnapshot`, `laneKey`, `laneSnapshot` (see
[`laneRead`](#lanereadspec--key--loader-colocation) and
[`LaneKeyOf`](#lanekeyoft--a-key-that-knows-what-it-holds)),
`domEventSource`, `noopEventSource`, `createReactNativeEventSource` (see
[Event sources](#event-sources)).

## See also

- [Common mistakes](./common-mistakes.md) — anti-patterns and the use-lane way to write them.
- [Supported architectures](./architectures.md) — the per-key ownership rule: RSC props, published (`external`), or client-owned.
- [Design notes](./design-notes.md) — the rationale behind these choices.
- [Cross-reader consistency](./consistency.md) — what two readers of one key are
  guaranteed to show each other.
