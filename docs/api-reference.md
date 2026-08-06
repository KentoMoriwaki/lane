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
<LaneProvider lane?={Lane} focusThrottleInterval?={number} eventSource?={LaneEventSource}>
  {children}
</LaneProvider>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `lane` | `Lane` | a fresh `createLane()` | The Lane instance to provide. Omit to let the provider create and own one. |
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
};
```

| Option | Default | Description |
| --- | --- | --- |
| `gcTime` | `300000` (5 min) | How long (ms) an entry is kept **after its last reader leaves** — the default for reads that do not set their own. Idle-time based, unrelated to `staleTime`/freshness. `Infinity` opts out. |
| `warmTime` | `60000` (1 min) | How long a settled entry **nobody has ever held** waits for its first reader — the default for reads that do not set their own. Shorter than `gcTime`'s and unrelated to it: this is spent on an arrival that has not happened, that one on a reader who was there and may return. Both situations here are short — the seconds between a hover and the click, a navigation that changed its mind — so a minute is generous for either; a prefetch placed further ahead than that should state its own. |

## Reading data

### `useLane(read)`

Subscribe a component to a keyed async read. A read is **one value** — its key,
its loader, and the options it is read with:

```ts
function useLane<T, C = T>(read: LaneReadSpec<T, C>): LaneResult<T>;

type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKeyOf<T> | LanePlainKey;
  loader: LaneLoader<T, C>;
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
load — snapshotted when the read is created, so a publication landing while the
read starts cannot change what the loader was handed. It lets a loader re-read
*as much as it already had* rather than only what the key describes: the
accumulated pages of a list, a cursor to resume from, a revision to send as
`If-None-Match`. It survives invalidation, which
clears the cached promise and not the last fulfilled value, and is `undefined`
again once the entry itself is gone — [removed](#remove--removeall), collected,
or invalidated while nothing was subscribed to hold it — so a loader must always
define what a first load means. It is not a way to skip work: the value is the
previous read's, and returning it unchanged strands the entry on stale data.

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
ignores `current` keeps inferring exactly as before — `useLane({ key: ["task",
id], loader: ({ signal }) => fetchTask(id, signal) })` still yields
`LaneResult<Task>` with no type argument. Give `C` explicitly only for a loader whose `current` is deliberately
narrower or wider than its result. [Why it is shaped this
way](./design-notes.md#a-loaders-input-includes-what-it-already-produced).

Returns a [`LaneResult<T>`](#laneresultt). Unwrap `result.promise` with `use()`
inside a `Suspense` boundary — it resolves to a [`LaneRead<T>`](#lanereadt)
(`{ data, refreshError }`):

```tsx
const { promise } = useLane({
  key: ["task", id],
  loader: ({ signal }) => fetchTask(id, signal),
});
const { data: task, refreshError } = use(promise);
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

type LaneReadSpec<T, C = T> = LaneUseOptions & {
  key: LaneKeyOf<T> | LanePlainKey;
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
publishing, invalidating, and removing *address an entry*, and none of them does.
Making them take the whole read would mean a mutation path importing fetchers —
and whatever request context those fetchers need — to name a key it already
knows. So the loaded type travels on the **key** instead: see
[`LaneKeyOf`](#lanekeyoft--a-key-that-knows-what-it-holds).

**Why colocate.** A key factory in one module and a fetcher in another are two
halves of one fact, and no type checks that a call site pairs them correctly —
`useLane(taskKeys.detail(id), () => fetchTasks(filters))` compiles and is wrong.
Options drift the same way, and more quietly: they live at the call site while
the key does not, so one component reads a key with `staleTime: 60_000` and the
next reads the same key with none.

**What the factory buys you.** At runtime it returns its argument — a hand-written
object literal reads the same way. What it adds is types:

- **`T` is inferred at the definition** from the loader's return type, so every
  consumer reads that type back instead of re-inferring it — and the `key` it
  hands back is a [`LaneKeyOf<T>`](#lanekeyoft--a-key-that-knows-what-it-holds),
  which is how the type reaches the write side.
- **The shape is checked where it is written**, so a mistyped option is an error
  at the definition rather than a silently ignored property at three call sites.
  (An object literal passed straight to `useLane` is checked too — what a
  variable-held literal loses, and `laneRead` restores, is the key tag and the
  option names.)

`C` — the type of [`current`](#uselaneread) — still defaults to `T`
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

**A spec describes one read, not a family.** Parameters live in the enclosing
factory — that is what makes the key and the loader agree, since both close over
the same variables. (The loader also receives the key in its context, so a
loader that is shared across keys can derive from it; for a per-key factory the
closure is both shorter and typed.)

**Bind what a loader needs, take what a key needs.** When the loader depends on
something that is *not* part of the key — a session, a tenant, an API client —
bind it once and let each factory take only its identity, rather than threading
the dependency through every signature:

```ts
export function taskReads(ctx: RequestCtx) {
  return {
    detail: (id: string) =>
      laneRead({
        key: taskKeys.detail(id),
        loader: ({ signal }) => fetchTask(ctx, id, signal),
        staleTime: 60_000,
      }),
    list: (filters: TaskFilters) => laneRead({ … }),
  };
}

// In React, bind it where the context is available:
const reads = useMemo(() => taskReads(ctx), [ctx]);
useLane(reads.detail(id)); // the argument list is exactly what decides the key
```

`taskReads(ctx).detail(id)` and `taskDetail(ctx, id)` build the same read; the
first keeps "what makes this read distinct" and "what it needs to run" in
separate places, which matters because only the first ends up in the key.

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

**The problem it solves is the key, not the plumbing.** The obvious way to give
loaders a context is to bind it into the factory — `taskLanes(ctx).detail(id)`.
That works for reading and breaks everywhere else, because naming an entry now
requires a context: a mutation, a Server Component, a component above the
provider, an error-boundary retry. Codebases resolve this by keeping a second,
parallel map of bare keys — and then every read exists twice, with the loaded
type restated by hand on the key side and no compiler check that the two agree.
Putting the dependency on the lane keeps the read a plain object whose arguments
are exactly what decides its key, so `.key` costs nothing to reach:

```ts
lane.set(taskLanes.detail(id).key, task);      // no context needed
laneSnapshot(taskLanes.list(filters), tasks);  // in an RSC
```

The mechanism is react-query's `Register`, and so is the asymmetry in naming:
`loaderMeta` is what you **declare and supply**, `meta` is what the loader
**receives** — exactly as react-query declares `queryMeta` and delivers
`context.meta`.

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
non-optional inside the loader. (This is the one place Lane is stricter than
react-query, where `meta` is per-query only and therefore always
possibly-`undefined`.) In a batch, a member's own value wins over the batch's.

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
(module augmentation), so an app has exactly one `loaderMeta` type. The *value*
is per provider, and providers nest — a client-only app can read its bootstrap
under a session-less meta and re-provide the same lane with the real session once
the user is known, keeping everything already cached.

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
two are deliberately *not* checked against each other: constraining a read's `key`
to `LaneKeyOf<T>` costs about 65% more type instantiations on every read, which is
a poor trade for catching a mismatch you have to construct on purpose.

Two things to know:

- **The tag is an assertion, not a proof.** `laneKey<Task>(…)` states what the
  entry holds and nothing verifies it. That is why the loaded type belongs on the
  read wherever a read exists — `laneRead` *infers* the tag from the loader, while
  a `laneKey` type argument is the one place in Lane where you state a type by
  hand.
- **A tagged key is a key.** It is the same array at runtime, matches the same
  entry, serializes the same way, and is accepted anywhere `LaneKey` is —
  `invalidate`, `remove`, `cancel`, scopes, hydration snapshots. Only `set` and
  `update` read the tag.
- **`laneKey` runs on the server too.** `use-lane` marks its React modules
  `"use client"` individually rather than marking the package, so `laneKey`,
  `laneRead`, and `createLane` are importable from a Server Component — the
  key module above really is importable from anywhere, including the RSC route
  that builds your [hydration snapshots](#hydration-rsc-seeding). The import path
  is the same `"use-lane"` in both graphs; there is no `/server` subpath to learn.

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
| `invalidate` | Invalidate this exact key, re-read, and return **the next read's promise** — awaitable, unlike `lane.invalidate` (a key alone does not know its loader; the hook holds the whole read). The returned promise is the one subscribed readers adopt, by the store's dedupe — never a second fetch. It resolves with the read's usual contracts: a failed refresh over existing data resolves `{ data: stale, refreshError }` rather than rejecting, an initial failure rejects, and resolving means the data settled — not that React committed. An invalidation skipped by `onlyIf` returns the current cached promise, so awaiting is always awaiting "the key's value after this call". Accepts the same `LaneInvalidateOptions` (e.g. `{ background: true, onlyIf: "settled" }` for a self-scheduled poll); defaults to an explicit transition. See [Derived reads](#derived-reads--reacting-to-a-source-that-actually-changed) for the cascade it enables. |
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
not. Passing them in would hoist that list to every call site and freeze it
there — it could not be built conditionally, or by the helper itself.

What you announce is not what you converge. What converges is what changed; what
is announced is what should look busy, which is usually the smaller set — a
`background: true` refresh is explicitly asking not to be one of them.

#### What to know

- **The action is not Lane's.** Its resolved value is ignored and its rejection
  is never caught, so a failed save cannot reach a reader as
  [`refreshError`](#lanereadt) — that field means a failed *refresh* over data
  still worth showing, which is a different fact about a different thing. Handle
  the failure inside the action, where you would have anyway.
- **Nothing is stored when the window opens.** An announcement schedules no read:
  the caller has not changed the source yet, so re-reading now would just fetch
  the pre-mutation data. Only the transitions open; the re-reads are the ones the
  action asks for.
- **Converge inside the action, however the change needs it.** `invalidate`,
  `set`, `update`, a prefix scope — all of them land in the same transition.
- **External reads do not have it.** The announcement promises that an
  invalidation is coming, and a published key's reader is the one that cannot
  make it — see [`LaneExternalResult`](#external--a-read-the-owner-publishes).
  The owner's own transition (a Server Action, a router revalidation) is already
  the pending signal there.
- **Announcing a published key throws** [`LaneOwnershipError`](#laneownershiperror),
  and the scope is checked before anything is announced, so a scope that reaches
  one is refused rather than half-applied.
- **`lane.startInvalidationTransition` outside any transition is close to a
  no-op.** Each reader opens an empty transition that commits immediately, so
  nothing shows pending — which is the thing you called it for, making the
  symptom its own diagnosis. It is documented rather than guarded because there
  is no way to ask React whether a transition is in progress.

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

No cascade to enumerate and no way to render a new source against stale
derived data — at the price that each identity is a fresh entry: a new-key load
starts from nothing (no `current`, no stale-on-error fallback; a failure
suspends into the Error Boundary like any first load), which is the ordinary
Suspense meaning of a key change. Old entries idle out through `gcTime`. A
server-provided hash is the stronger key material when you have one — stable
across sessions and reverts — where `revision` is session-local and only ever
moves forward.

### `LaneRead<T>`

What a read resolves to — `use(promise)` returns this:

```ts
type LaneRead<T> = {
  data: T;
  revision: number;
  refreshError?: unknown;
};
```

| Field | Description |
| --- | --- |
| `data` | The value for the key. |
| `revision` | The identity of `data`'s **content** — a serializable stand-in for the reference equality [structural sharing](#structural-sharing) guarantees. A refetch that came back deep-equal keeps the previous reference *and* the previous revision; only a genuine content change (through any write path: a loader, `set`, `update`) mints a new one, from a lane-wide counter. Equality is the entire contract — nothing about order, density, or reuse across entries may be read into the numbers, and they are session-local: never serialize one into a snapshot. What it is for is naming content where a reference cannot go — chiefly as **key material for a derived read**, so the derived key changes exactly when the source's content does: `useLane(prepareRead(source.data.documentId, source.revision))`. For comparing two reads you already hold, `revision` adds nothing over `===` on `data`. A stale-on-error result keeps serving the old data under the old revision — the pair is one settlement and cannot tear. **On an [external](#external--a-read-the-owner-publishes) read the identity is one notch weaker: the publication's, not the content's.** An external entry keeps no previous value to compare against (its weak retention forbids the strong reference), so "unchanged" is not a fact the client can establish — every publication mints, a republish of identical content included. Same revision ⇒ same content still holds; the converse does not, so a derived key built from an external revision re-derives per publication. When the content has a real version, its owner has it — ship it in the payload and key on that instead. |
| `refreshError` | Present when the most recent **refresh** of an entry that already has data failed (see [Stale-on-error](#stale-on-error)): the stale `data` keeps being served and the error rides alongside it. Absent when the latest read succeeded. Initial-load failures reject `promise` instead. Carrying the error *in the resolved value* (rather than a field read live from the store during render) keeps `data` and `refreshError` consistent under concurrent rendering and avoids a render-purity violation. |

### `LaneGatedResult<T>`

What `useLane` / `useLanePromise` return when the loader may be `undefined` —
`promise` widens to `Promise<T> | undefined`, and `invalidate` widens the same
way (while disabled there is no loader to re-read with, so it still clears the
entry but has no next read to return):

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

### `external` — a read the owner publishes

Some keys are not the client's to fetch. An RSC route already loaded the data and
[publishes](#lanehydration) it; a router loader did the same. The read still has
to say where its value comes from, and `external` is that declaration — a real
loader that **waits for the publication** instead of going after the data itself:

```ts
import { external, laneRead } from "use-lane";

export const taskLanes = {
  detail: (id: string) => laneRead<Task>({ key: ["task", id], loader: external }),
};

const { promise } = useLane(taskLanes.detail(id)); // no fetch — it waits
```

It is a genuine loader value, not a flag, and that is deliberate: the loader slot
already answers "who fills this key", so it carries three values instead of
growing a fourth option — a function is client-owned, `external` is published from
outside, `undefined` is [gated off](#conditional-reads-gating). Every read path in
`useLane` stays one unconditional read.

**`T` is annotated, because nothing infers it.** `laneRead<Task>({ … })` — a
loader that never loads has no return type to read it from. It is the one cost of
the form and it is paid once, at the definition.

**The spec takes the key and the loader, and nothing else.** Writing any other
option is a type error at the `laneRead` call:

| Absent option | Why |
| --- | --- |
| `staleTime`, `gcTime` | Freshness and retention are the publisher's decision. Nothing local can re-read this key, so "stale" has no action attached to it. |
| `refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect` | Each one triggers a re-fetch, which is exactly the ownership violation this read exists to prevent. |
| `loaderMeta` | Nothing here is handed to a loader. |

#### What it does while it waits

The promise is settled by being **replaced**. A publication of the same key
overwrites the entry *and* resolves the waiting read with the value it installed,
so a reader that is suspended on it converges immediately — including one that has
not committed yet, which has no subscription for a notification to reach.

- **Before the first publication**, a read suspends. Boundary fallback, no
  request. This makes "read a key some ancestor boundary will publish" a supported
  pattern — including from a component the publisher cannot pass props to.
- **On publication**, the wait resolves with the published value, and the store's
  own promise holds the same value: readers that retried and readers that kept the
  old promise agree. A reader inside a hidden `<Activity>` converges the same way
  when its tree is revealed — see [under `<Activity>` and router
  keep-alive](./consistency.md#activity).
- **After ~10 seconds with no publication**, it rejects with
  [`LaneExternalTimeoutError`](#laneexternaltimeouterror) to your Error Boundary.
  A read nobody publishes is a typo or a missing boundary, and failing loudly is
  the point — the alternative is a fallback that never resolves.

**A key holds its latest publication, wherever it is read — including a restored
tree.** If two routes publish the same key and the user navigates back to the
first, its readers show the *second* route's value, not the one this route
published: the reveal synchronously adopts the store's current value. That is
the correct semantics for genuinely shared data (a session, a workspace); for a
value that belongs to one route, put the route in the key.

#### Gating

`loader: cond ? external : undefined` gates an external read exactly as an absent
client loader does — nothing is stored or awaited while disabled, and the result
widens to [`LaneGatedResult`](#lanegatedresultt) minus `invalidate`.

#### What the result does not have

`useLane` of an external read returns a `LaneExternalResult<T>` — a
[`LaneResult`](#laneresultt) without `invalidate`. There is no loader to re-run,
so invalidating could only empty a key its owner is expected to refill; the store
throws on the attempt, and the type removes the call before you can make it.

`lane.prefetch` rejects an external read for the same reason, at the type level
and at runtime: prefetching is loader execution, and warming this key would start
a wait whose only outcome is the timeout.

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
mounted outside the boundary that publishes it and no publication has happened
yet. Compare the serialized key in the message against what the publisher seeds.

Two runtime behaviors worth knowing (both measured in a production build):

- **The rejection is the entry's state, not the reader's.** A reader mounted
  after the timeout receives the same rejection immediately — it does not start
  a fresh 10-second wait. The next publication clears it: the key serves again,
  with no fallback, the moment a value lands.
- **An errored reader does not heal itself.** React error boundaries stay on
  their error UI after a later publication revives the key, so a screen that can
  hit this error needs a reset path (a retry button that remounts the boundary,
  or a boundary keyed on the route).

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
  (`staleTime` / `refetchOnFocus` / `refetchOnReconnect` re-subscribe;
  the new options apply on the next read). A batch is N `useLane`s feeding one
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

### `useInfiniteLane(read)` — a cursor-paginated list

Read an infinite list as **one key holding the whole accumulated list**, with the
page depth read back out of the cached value rather than kept in the key or in
component state. It is `useLane` plus a loader that walks the cursor chain as
deep as [`current`](#uselaneread) already is — no core machinery,
nothing an ordinary read does not already do.

```ts
function useInfiniteLane<P, C>(read: {
  key: LaneKey;
  initialCursor: C;
  fetchPage: (cursor: C, context: { signal?: AbortSignal }) => Promise<P>;
  nextCursor: (page: P, cursor: C) => C | null;
} & LaneUseOptions): {
  promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  loadMore: () => Promise<LaneRead<InfiniteLaneValue<P, C>>> | undefined;
  isInvalidationPending: boolean;
  isBackgroundPending: boolean;
  invalidate: (
    options?: LaneInvalidateOptions,
  ) => Promise<LaneRead<InfiniteLaneValue<P, C>>>;
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
const { promise, loadMore, isInvalidationPending } = useInfiniteLane(
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
  `isInvalidationPending` covers it with no `useTransition` of your own. The name
  is not a mismatch — `update` is a [prefilled
  invalidation](./design-notes.md#authoritative-publication-is-secondary), so an
  append converges through the same surface an `invalidate` does. It is a no-op
  at the end of the list; gate your control on `data.hasNext` so an over-eager
  click does not cost even a notification.
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
  if (!data.hasNext || isInvalidationPending || refreshError) return;
  ```

  `refreshError` clears on the next successful read, so recovery is an explicit
  retry — a button calling `loadMore` again, which resumes from the same cursor.
  A caller that would rather not route through the rendered value can await
  `loadMore` instead: it hands back the entry's next promise, which *resolves*
  with `refreshError` set rather than rejecting. (The equivalent React Query list
  has the same shape — `hasNextPage` stays `true` after a failed `fetchNextPage`
  — and gates on `isFetchNextPageError` instead.)
- **Depth is only as durable as the entry.** Remounting reuses the cached value
  with no request at all, and the depth comes back with it, so the *next* refresh
  covers every page again. An `invalidate` while *nothing* is mounted is the
  exception: it drops the entry (no cache, no subscriber), so the next mount
  starts from one page — the same asymmetry described under
  [`current`](#uselaneread).

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
prefetch<T, C = T>(read: LaneReadSpec<T, C>): Promise<LaneRead<T>>;

// When LaneRegister declares a loaderMeta, it is required here — this is the
// one read that happens outside React, so it cannot take it from the provider.
prefetch<T, C = T>(
  read: LaneReadSpec<T, C>,
  options: { loaderMeta: LaneRegister["loaderMeta"] },
): Promise<LaneRead<T>>;
```

`prefetch` takes the read's key, its loader, and its `loaderMeta` — the three
things running one needs. Everything else on the read describes what a *reader*
does with the value (`staleTime` / `gcTime` / `refetchOn*`), and warming is not
the read, so those stay the eventual reader's call.

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
  cached promise — the loader runs once. `prefetch` always reads with
  `"revalidate"` semantics, so it never discards an in-flight or settled cache.
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
| `gcTime` | the lane's | How long (ms) **this read's** value is worth keeping once nothing holds it — this read's override of [`createLane`](#createlaneoptions)'s, and the way to say "do not serve this again after I leave". `0` makes every remount a fresh load; `Infinity` keeps it. It reads as a memory setting and is a freshness one too, because for an *idle* entry those are the same question: a value nobody holds is kept for exactly one reason, the reader who might come back. Which is why the load a remount starts after the deadline **suspends** — the entry is gone, so the wait joins whatever transition the remount is part of, instead of committing a stale value and refreshing it afterwards. The deadline is set when the entry goes idle, from the `gcTime` of whoever held it last; eviction is never synchronous, so an unsubscribe and a resubscribe in one task (StrictMode's double invoke, a re-suspension) collect nothing. |
| `warmTime` | the lane's | How long **this read's** value is kept for a reader who has *not arrived yet*, measured from the moment it settles. Two situations, and they are the same one: a value warmed by [`prefetch`](#prefetch) that nobody has read, and an entry created by a render that suspended and unmounted before it could commit. Both are a load done for a reader who may still be coming, and this says how long "still coming" stays plausible. Deliberately not `gcTime`, which answers "somebody had this and left — how long is it worth keeping for their return": the two share a unit and nothing else. **The clock never runs while the read is in flight** — an entry nobody holds is not evidence that nobody is coming, and a load still running is evidence that somebody might be, so collecting one would abort a read a suspended render is still waiting on. |
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

> **These are the client-owned half of the API.** Every method on this page
> writes to an entry, and a key whose value was **published** — read with
> [`external`](#external--a-read-the-owner-publishes), or seeded by
> [`LaneHydration`](#lanehydration) — is not the client's to write. `set`,
> `update`, `updateAll`, `invalidate`, `invalidateAll`, `remove`, `removeAll` and
> `prefetch` all throw [`LaneOwnershipError`](#laneownershiperror) on one. See
> [mutating a server-owned key](#mutating-a-server-owned-key) for what to do
> instead.

### `LaneReadError`

```ts
class LaneReadError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;
  // `cause` is the loader's own error
}
```

What a failed read throws — the loader's error wrapped in one that says *which
key* failed. Only a first load (nothing to show) throws at all; a failed refresh
over existing data resolves `{ data, refreshError }` instead, and that field
carries the loader's error **unwrapped**.

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

**A published key is not wrapped.** `invalidate` and `remove` both throw
[`LaneOwnershipError`](#laneownershiperror) on one, so an external failure would
be handing out a recovery that cannot be performed; those keep their own shape
(and [`LaneExternalTimeoutError`](#laneexternaltimeouterror) already carries the
same `key` for identification).

**It does not survive the server.** React replaces an error thrown while
rendering on the server with a digest before the client sees it, so a fallback
recovering by `error.key` recovers from client-side failures only. A read that
failed during SSR reaches the browser as an ordinary error.

#### Why a rejection is never retried by a read

A cached rejection is served to every later read of the key until the key is
invalidated, removed, or collected. No read retries one.

Retrying is an event; a render is not one. React renders a suspended reader as
many times as it likes and throws the work away, so a retry decided during a read
fires again on every attempt: the reader is handed a fresh pending promise each
time, suspends instead of throwing, and the failure never reaches the boundary at
all: against a server that is down, the fallback would spin forever.

So recovery is always something that *happens*: an `invalidate`, a `remove`, a
revalidation trigger firing from an effect, or garbage collection. Reads only
read.

### `LaneOwnershipError`

```ts
class LaneOwnershipError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;
}
```

Thrown synchronously — in production as well as development — when a client
mutation reaches an entry whose value came from outside. An entry becomes
externally owned when it is read with [`external`](#external--a-read-the-owner-publishes)
**or when a publication seeds it**, and it stays that way for as long as the
entry lives; the second reader of a key does not get to decide nobody owns it.

The message names the serialized key and the operation. It is not a lint: the
write it stops is one that silently loses — either the next publication
overwrites it, or no publication comes and the local edit outlives the truth.

`invalidate` is checked after its `onlyIf` gate, so a conditional invalidation
that would not have done anything (a `refetchOnMount` trigger over a fresh
published value, say) is a no-op rather than a crash. One that *would* discard
the owner's value throws.

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
  after?: Promise<unknown>;
};
```

- omit `onlyIf` → always invalidate.
- `"stale"` → only fulfilled entries older than `staleTime`. With no `staleTime`
  the default (`Infinity`) applies and nothing matches; a rejected entry is never
  stale either, so a failed *first* load is not retried this way (`"settled"` does
  retry it, and a failed *refresh* keeps the previous value, which stays as old as
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
  const { promise, invalidate } = useLane({
    key: ["task", id],
    loader: ({ signal }) => fetchTask(id, signal),
  });
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

> **`snapshots` must be produced outside render** — one object per data payload,
> delivered to the component. A Server Component's props satisfy this, and so does
> a router loader's data ([React Router / TanStack](./integrations.md#data-mode--loaders-publish-into-lane));
> both hand back the same object across re-renders and a new one when the data
> reloads, which is exactly when re-seeding is wanted. Nothing about it is
> server-only.
>
> What breaks is building it *inside* a render —
> `<LaneHydration snapshots={buildSnapshots(seeds)}>` in a component body. Every
> render then hands over a new object, so every render suspends on a fresh
> hydration promise and the boundary never commits: the subtree stays on its
> Suspense fallback indefinitely. (Same failure as an inline
> [`Promise.all`](#uselanesallreads-options--a-batch-read), for the same reason.)
> If the assembly has to happen in a component, `useMemo` it on the source data.

Build the snapshots on the server from the same keys your hooks use:

```ts
const snapshots: LaneHydrationSnapshots = {
  entries: [
    { key: ["current-user"], data: currentUser },
    { key: ["tasks", filters], data: tasks },
  ],
};
```

The *same keys* can be the same code. [`laneKey`](#lanekeyoft--a-key-that-knows-what-it-holds)
and [`laneRead`](#lanereadspec--key--loader-colocation) are importable from a
Server Component — only the modules that touch React carry `"use client"` — so a
key module shared with your hooks can be imported here directly, and the seed path
does not need a duplicate list of key literals to stay server-safe:

```ts
// keys.ts — imported by both the RSC seed path and the client hooks.
export const taskKeys = {
  list: (filters: TaskFilters) => laneKey<Task[]>(["tasks", filters]),
};

// page.tsx — a Server Component
const snapshots = { entries: [{ key: taskKeys.list(filters), data: tasks }] };
```

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

#### What seeding decides

**Everything a publication seeds becomes server-owned.** The value is a copy of
something the publisher holds, so from the client's side the key is read-only:
`set` / `update` / `invalidate` / `remove` on it throw
[`LaneOwnershipError`](#laneownershiperror), and `useLane` hands back no
`invalidate` when the read declares itself
[`external`](#external--a-read-the-owner-publishes).

That is a behavior change in 0.8. Before it, a seeded key could be edited locally
and usually appeared to work — until a navigation re-streamed the payload and
overwrote the edit, or the payload never came and the edit outlived the truth.
The pairing was never sound; it is now refused at the point of the write instead
of failing later somewhere else.

Two consequences worth planning for:

- **Seed only what the client will not write to.** A key the client controls
  should be [client-owned](./architectures.md#client-owned-reads) and never appear
  in a snapshot. Mixing is the one configuration Lane rejects.
- **Mutations go back through the publisher.** See
  [mutating a server-owned key](#mutating-a-server-owned-key).

Hydration is for seeding and navigation, not post-mutation patching — and for a
published key, "post-mutation patching" is exactly the thing that no longer
exists: the mutation's own republication is the patch.

### Mutating a server-owned key

There is one channel, and it does not pass through Lane:

```txt
mutate the source  ->  revalidate  ->  the payload re-streams  ->  republish  ->  readers converge
```

In the App Router that is a Server Action:

```ts
"use server";

export async function updateTaskAction(id: string, input: UpdateTaskInput) {
  const task = await db.updateTask(id, input);
  revalidatePath("/tasks"); // the route republishes; every seeded key updates
  return task;
}
```

In a client router it is the router's own revalidation — see
[Data mode](./integrations.md#data-mode--loaders-publish-into-lane).

What that buys is agreement: one publication updates the entity, every list it
appears in, and every count derived from it, because one source read produced them
all. The client-owned equivalent has to name each of those keys and get the set
right.

What it costs is the round trip, and the answer to that is **`useOptimistic` over
the read value** — display state that belongs to the action, not a write to a key
you do not own:

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

Two anti-patterns to name, because both look reasonable:

- **`lane.set` for optimism.** It publishes a guess to *every* reader of the key
  and has no rollback; on a published key it now throws. Optimism is per-action
  display state — `useOptimistic`.
- **`lane.invalidate` after the action.** It asks the client to re-fetch a key the
  client does not fetch. The revalidation inside the action already brings the new
  payload; adding an invalidation converges nothing and throws.

## Lifecycle behavior

- **Stale-on-error.** <a id="stale-on-error"></a> When an entry already has a
  fulfilled value and its next read rejects (after invalidation, focus refetch,
  or a `set` of a rejecting promise), the cached promise keeps resolving
  with the **last fulfilled value** and the failure surfaces as `refreshError`.
  Freshness keeps the original fulfillment time, so staleness policies still
  treat the data as old and retry. Only an **initial** load (no previous value)
  rejects the promise and reaches the Error Boundary.
- **The last fulfilled value.** One value per entry backs both the stale-on-error
  fallback above and the [`current`](#uselaneread) a loader is
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
- **Garbage collection.** An inactive entry (no subscribers) is retained for the
  lane's `gcTime` (`createLane({ gcTime })`, default 5 min; `Infinity` opts out)
  and then collected. Collection is a single coalesced sweep per lane — armed
  when an entry loses its last subscriber, so timing is approximate. Because the
  sweep is lane-wide, it also reclaims orphans (entries from renders that never
  committed) on whatever cycle a later unsubscribe triggers.
- **Retention of published entries.** <a id="external-retention"></a> An
  [external](#external--a-read-the-owner-publishes) entry is **exempt from
  `gcTime`** — Lane does not time out a value it did not fetch and cannot
  re-fetch. It holds the value weakly instead, so it lives exactly as long as
  something else keeps it reachable: the publisher's payload (the snapshots
  object a publication came from is tethered to what it published, so the value
  lives as long as the framework holds the payload) or any committed reader
  (React state holds the promise it is rendering) — including a reader inside a
  hidden `<Activity>`, which is [why keep-alive needs no `gcTime`
  tuning](./consistency.md#activity). In practice: a back-navigation
  into a tree the framework kept shows what that tree held, with no request; a
  key whose payload *and* readers are both gone reads as absent and its next read
  waits for the next publication — which is the same state the publisher is in,
  since it would have to re-fetch too. Client-owned entries are untouched by any
  of this and keep the normal `gcTime` behavior.

## Type exports

`InfiniteLaneOptions`, `InfiniteLaneReadSpec`, `InfiniteLaneResult`, `InfiniteLaneValue`,
`Lane`, `LaneClientLoader`, `LaneEntryInfo`, `LaneEventSource`, `LaneExternalLoader`, `LaneExternalReadSpec`, `LaneExternalResult`, `LaneGatedExternalReadSpec`, `LaneGatedExternalResult`, `LaneGatedReadSpec`, `LaneGatedResult`, `LaneHydrationSnapshots`, `LaneInvalidate`, `LaneInvalidateOptions`,
`LaneKey`, `LaneLoader`, `LaneLoaderContext`, `LaneLoaderMeta`, `LaneLoaderMetaArgs`, `LaneLoaderMetaProp`, `LaneOptions`,
`LaneKeyOf`, `LanePlainKey`, `LaneProviderProps`, `LaneRead`, `LaneReadSpec`, `LaneRefetchOnFocus`, `LaneRefetchOnMount`, `LaneRefetchOnReconnect`, `LaneRegister`,
`LaneResult`, `LaneRevalidateHandlers`,
`LaneScope`, `LaneSnapshot`, `LaneUpdater`, `LaneUseOptions`, `LaneValue`, `LaneWhenStale`,
`ReactNativeAppState`, `ReactNativeEventSourceOptions`, `ReactNativeNetInfo`.

Runtime exports beyond the hooks and `createLane`: `external` (see
[`external`](#external--a-read-the-owner-publishes)), `LaneExternalTimeoutError`,
`LaneOwnershipError`, `LaneReadError`, `laneRead`,
`infiniteLaneRead`, `laneKey`, `laneSnapshot` (see
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
