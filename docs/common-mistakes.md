# Common mistakes

Patterns people (and AI agents) reach for out of React Query / SWR / `useEffect`
habit, and the use-lane way to write them instead.

The single best heuristic: **if you are adding `useState` / `useEffect` /
`setState` around data that came from a Lane read, stop — that is almost always
the mistake.** Lane keeps the data in React state *for you*, behind the promise.
You read it with `use()`; Suspense, Error Boundaries, and transitions do the
rest. There is no second copy to keep in sync.

For the reasoning behind these rules, see [design notes](./design-notes.md); for
exact signatures, [API reference](./api-reference.md).

## Reading data

How you read a Lane promise — and where loading and errors actually live.

### Reading data through an effect (the big one)

**Don't** fetch in an effect and mirror the result into state:

```tsx
function Profile({ id }: { id: string }) {
  const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
  const [user, setUser] = useState<User>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    promise.then(({ data }) => setUser(data)).catch(setError);
  }, [promise]);

  if (error) return <ErrorView />;
  if (!user) return <Spinner />;
  return <h1>{user.name}</h1>;
}
```

This re-creates everything Lane and React already give you — a second copy of the
data, a hand-rolled loading flag, an error branch — and it is *worse*: the
`.then` resolves after commit, so there is always an extra render with no data;
the mirrored state can tear from the promise under concurrent rendering; and you
lose transitions, so the screen flashes on every refetch.

**Do** read the promise with `use()` and let the boundaries own loading/errors:

```tsx
function Profile({ id }: { id: string }) {
  const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
  const { data: user } = use(promise);
  return <h1>{user.name}</h1>;
}

// Loading and errors live in the boundaries — once, around the subtree:
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<Spinner />}>
    <Profile id={id} />
  </Suspense>
</ErrorBoundary>;
```

No `useState`, no `useEffect`, no `.then`. (Also don't make the component `async`
or `await` the promise in the body — `use(promise)` is the read.)

### "But I need a loading / error state"

You have them — they live in React, not in your component's state:

| You want | Use |
| --- | --- |
| Initial loading (no data yet) | a `Suspense` fallback |
| Initial-load failure (nothing to show) | an Error Boundary |
| "Refreshing" while the current data stays on screen | `isTransitionPending` (explicit) / `isBackgroundPending` (focus, poll, …) from `useLane` |
| A refresh that failed *over* existing data | `refreshError` from `use(promise)` — render `data` **and** a small inline hint |

**Don't** keep `const [isLoading, setIsLoading] = useState(true)` — there is no
place to set it correctly and it duplicates Suspense.

**Don't** treat `refreshError` as fatal (throwing it, or replacing the whole UI).
A failed refresh keeps the last good `data`; show it with a non-blocking hint.
Only an *initial* load (no previous value) rejects and reaches the Error Boundary.

## Loading & revealing on your terms

Three patterns, one idea: **owning a read and suspending on it are separate
acts.** `useLane` starts (and caches) the load; `use()` is what suspends and
reveals it — and unlike other hooks, `use()` may be called conditionally. So you
get to choose *whether* to load (gate the loader), *when* to reveal (gate the
`use()`), and *how* to switch keys without a flash (transition the change).

### Conditional reads (gate the loader)

**Don't** break the rules of hooks to skip a read:

```tsx
if (id) {
  const { promise } = useLane(["user", id], loader); // conditional hook call
}
```

**Do** gate the read by passing `loader: undefined`, then unwrap conditionally:

```tsx
const { promise } = useLane(
  ["user", id],
  id ? ({ signal }) => fetchUser(id, signal) : undefined,
);
const user = promise ? use(promise).data : null;
```

A gated read fetches nothing, subscribes to nothing, and stores nothing — use it
for data you might *never* need. The opposite need — load now, reveal later — is
[deferred reads](#deferred-reads-preload-reveal-lazily), next.

### Deferred reads (preload, reveal lazily)

You want a slow read's data, but not at the cost of first paint — render the
screen now, fill that one region in when it resolves, and never flash a fallback.

**Don't** reach for an effect + `setState` (the big one again), and **don't** gate
the *loader* to "hold it back":

```tsx
const { promise } = useLane(["graph", id], reveal ? loader : undefined);
// Gating the loader delays the FETCH — the data lands late, not early.
```

Gating the loader is the [conditional](#conditional-reads-gate-the-loader) case —
for data you might *never* need, not data you *will* need but want off the
critical paint.

**Do** keep the loader always set (the fetch starts and caches immediately), gate
only the `use()` call, and flip the reveal inside a transition, so the suspend
holds the committed placeholder instead of showing the fallback:

```tsx
const [reveal, setReveal] = useState(false);
const [isPending, startTransition] = useTransition();

useEffect(() => {
  startTransition(() => setReveal(true)); // reveal after the first commit, in a transition
}, []);

// Loader always set → the fetch starts on the first render, not when revealed.
const { promise } = useLane(["graph", id], ({ signal }) => fetchGraph(id, signal));

if (!reveal) return <GraphSkeleton busy={isPending} />; // first render: no use(), no suspend
const { data } = use(promise); // now suspends — the transition keeps the placeholder
return <Graph data={data} />;
```

This is the deferred half of that split: own the read (load now), defer the
`use()`. A plain `setReveal(true)` *without* the transition would flash the
Suspense fallback. And the `useState` / `useEffect` here drive the *reveal* (local
UI state), **not** the data — the data still comes from `use(promise)`. See
[deferred reads](./api-reference.md#deferred-reads-render-first-swap-when-ready)
for staggered or multiple reveals and the full set of caveats.

### Key changes that flash (filters, navigation, props)

A key built from changing input — a filter, the route, or a prop — suspends and
flashes the Suspense fallback when that input changes, unless the change runs in a
transition. **Don't** stash the previous data in state to paper over it, and
**don't** change the key outside a transition.

**Do — transition at the source.** Whoever owns the state change wraps it, so the
key change is non-blocking:

```tsx
const [isPending, startTransition] = useTransition();
const select = (next) => startTransition(() => setSelectedId(next));
```

When the key derives from a **prop**, that source is usually the *parent* — it
should wrap the update so the child's key change is held. Lane keeps the promise in
React state, so the current screen stays live until the next one resolves; no
hand-rolled "keep previous data" needed. (A genuine *initial* load still suspends —
that is expected.)

**Do — defer locally when you don't own the source.** If the prop changes urgently
(a router param, a parent you can't change), or you want *only this subtree* to lag
while the rest updates now, `useDeferredValue` the input and derive **both the key
and the loader** from the deferred value:

```tsx
function Detail({ id }: { id: string }) {
  const deferredId = useDeferredValue(id);
  const isStale = deferredId !== id; // drive a pending affordance off this
  const { promise } = useLane(["user", deferredId], ({ signal }) =>
    fetchUser(deferredId, signal),
  );
  return <Profile user={use(promise).data} stale={isStale} />;
}
```

Use the deferred value for the loader too, not just the key: during the lagging
render `useDeferredValue` returns the *old* `id` while the raw `id` prop is already
the new one, so mixing them would register the old key against a fetch for the new
target. `useDeferredValue` defers the *reveal* only — the fetch still runs, and a
genuine first load still suspends, so keep a `<Suspense>` above. See
[transitions & the back/forward caveat](./integrations.md#transitions-and-the-backforward-caveat).

## Suspense boundaries decide what stays mounted

A boundary is not just where the spinner goes — it is the unit of UI that
**survives its own initial reads**. A read with no prior value suspends to the
*nearest ancestor* boundary, and React replaces everything below it with that
fallback until the read resolves. So a lazily mounted surface that fires an initial
read — a **modal, popover, combobox, dropdown, tab panel, drawer** — *unmounts
itself* (closes, loses focus, drops in-progress input) when its only boundary is
out on the page.

This is the one migration surprise with no analogue in the `isLoading` world: a
flag renders a spinner *in place*, but a suspend tears the subtree down to the
ancestor fallback.

**Don't** rely on a page-level boundary for content that opens in an overlay:

```tsx
// The page's <Suspense> is the nearest boundary. Opening this modal fires an
// initial read → it suspends → the *page* fallback replaces the modal. It closes.
<Modal isOpen={open}>
  <FilterEditor id={id} /> {/* reads options via useLane → suspends */}
</Modal>
```

**Do** give each ephemeral surface its own boundary at its content root, so the
fallback renders *inside* it and the surface stays mounted:

```tsx
<Modal isOpen={open}>
  <Suspense fallback={<Spinner />}>
    <FilterEditor id={id} />
  </Suspense>
</Modal>
```

The same rule covers **tab panels** — switching to a tab that reads should keep the
tab bar live, so put a boundary per panel and change tabs in a transition — and
**popover / combobox option lists** — the boundary goes inside the popover, not on
the trigger.

Mind the split: this is a surface's *initial* read (no prior value — it *must*
suspend). Once a value exists, changing a filter or key *inside* the surface rides
a transition and keeps it live (see [key changes that
flash](#key-changes-that-flash-filters-navigation-props)) — no extra boundary
needed for that.

## Keys & the loader

The two inputs to `useLane`: the **key** that identifies a read, and the
**loader** that runs it.

### Keep keys stable and serializable

**Don't** put a value that changes every render into the key — it refetches every
render:

```tsx
useLane(["search", { q, ts: Date.now() }], loader); // new key each render → fetch storm
```

**Do** derive the key deterministically from its inputs:

```tsx
useLane(["search", q], loader); // same q → same key → one shared, cached request
```

The loader is the opposite: Lane dedupes by **key**, not by loader identity, so
the loader can be an inline arrow — you do **not** need `useCallback` on it. Just
let it close over the current inputs.

### Read a key once, then pass the value down

Lane dedupes by key, so reading `["task", id]` in a parent *and* again in its
child costs one request either way. That makes it tempting to skip the prop and
just read it wherever it is needed. Don't — the cost isn't the fetch.

**Don't** re-read a key a component above you already has:

```tsx
function TaskPage({ id }: { id: string }) {
  const { data: task } = use(useLanePromise(["task", id], loader));
  return <><TaskHeader id={id} /><TaskBody id={id} /></>;
}

function TaskHeader({ id }: { id: string }) {
  const { data: task } = use(useLanePromise(["task", id], loader)); // same data, third reader
  return <h1>{task.title}</h1>;
}
```

**Do** read where the data enters the screen and hand it down:

```tsx
function TaskPage({ id }: { id: string }) {
  const { data: task } = use(useLanePromise(["task", id], loader));
  return <><TaskHeader task={task} /><TaskBody task={task} /></>;
}

function TaskHeader({ task }: { task: Task }) {
  return <h1>{task.title}</h1>;
}
```

Three readers of one key are three subscriptions, three `isTransitionPending`
flags to reconcile, three places that can suspend, and three independently
scheduled convergences — the whole reason
[cross-reader consistency](./consistency.md) has anything to say. A child taking
a prop cannot disagree with its parent, needs no Lane provider to test, and reads
like ordinary React.

**The exception is distance.** Two genuinely separate surfaces — a header badge
and a detail pane in different subtrees, a modal that mounts on its own — should
each read the key. Threading a prop there would mean lifting it to a common
ancestor far above both and routing it through components with no business
knowing about it, which is worse. The rule is *one owner per key per subtree*,
not *one reader per key*.

This is about the **same** key. Rendering N rows that each read a *different*
key — `["task", row.id]` — is the right shape; see
[batch reads](./api-reference.md#uselanesallreads-options--a-batch-read).

### Don't drop the abort signal

**Don't** ignore the `signal` the loader is handed — a superseded request keeps
running:

```tsx
useLane(["user", id], () => fetchUser(id));
```

**Do** forward it to `fetch`, so a stale request aborts when the key changes or
the entry refreshes:

```tsx
useLane(["user", id], ({ signal }) => fetchUser(id, signal));
```

## Mutations & local state

Writing data, and the local React state that lives around a read.

### Patching state after a mutation

**Don't** call the API and then hand-patch every copy of the data:

```tsx
const updated = await patchUser(id, { name });
setUser(updated);                                              // this copy…
setUserList((xs) => xs.map((u) => (u.id === id ? updated : u))); // …and every other copy
```

**Do** change the source, then converge by re-reading or publishing the confirmed
value:

```tsx
const lane = useLaneInstance();

await patchUser(id, { name });
lane.invalidate(["user", id]);      // re-read the affected key in a transition
// or publish the server-confirmed entity directly:
// lane.set(["user", id], updated);
// and invalidate broader derived reads by prefix:
// lane.invalidateAll(["users"]);
```

There is **no `useMutation`** by design — the mutation call and form state are
React's job; Lane only re-points the promise. See
[mutation convergence](./api-reference.md).

### `set` is not optimistic UI

**Don't** use `set` for a *guess*, and don't write optimistic values into Lane
(every consumer would see the guess), or hold them in `useState` with manual
rollback.

**Do** keep optimistic state local to the action with `useOptimistic` /
`useActionState`. `set` is for data you *already have* (server-confirmed); the
rest of the app keeps rendering confirmed data until invalidation or `set`.

```tsx
const { data } = use(promise);
const [optimistic, addOptimistic] = useOptimistic(data, applyGuess);
```

### Editing loaded data (a draft)

"I loaded a user and want an editable form" looks like it breaks the
no-`setState` rule — it doesn't. A **draft is local UI state** (the user's
in-progress edits), not a cache of server data. Lane keeps the canonical value;
the draft is a copy you deliberately fork and mutate. So `useState` / form state
is exactly right here — the trick is *seeding* and *resyncing* it without an
effect.

**Simplest — an uncontrolled form.** Let the DOM hold the draft: seed it from the
loaded value with `defaultValue`, submit with `useActionState`, converge with
`set` / `invalidate`:

```tsx
const { data: user } = use(promise);
const lane = useLaneInstance();
const [, save, pending] = useActionState(async (_prev, form: FormData) => {
  const updated = await patchUser(id, { name: String(form.get("name")) });
  lane.set(["user", id], updated); // publish the confirmed value (or lane.invalidate)
  return null;
}, null);

return (
  <form action={save}>
    <input name="name" defaultValue={user.name} />
    <button disabled={pending}>Save</button>
  </form>
);
```

No fetched data in `useState` at all.

**When you need a controlled draft** (validation, dirty state, live preview), seed
`useState` from the value you already have at render — never from an effect:

```tsx
const { data: user } = use(promise);
const [draft, setDraft] = useState(user); // initialized once, at render
```

**Don't** resync it with an effect:

```tsx
useEffect(() => setDraft(user), [user]); // extra commit; can clobber edits mid-keystroke
```

**Do** resync during render with the previous-value pattern — when an `invalidate`
(or refetch) lands a new remote value, reset the draft *in the same render that
delivers it*. Because Lane swaps the promise inside a transition, this reset rides
that transition: the draft and the new data commit together, with no effect and no
extra paint.

```tsx
const { data: user } = use(promise);
const [draft, setDraft] = useState(user);
const [base, setBase] = useState(user); // the remote value the draft was forked from

if (user !== base) {
  // A new remote value arrived (post-invalidate / refetch) — adopt it.
  setBase(user);
  setDraft(user);
}
```

This is React's official "[adjust state while
rendering](https://react.dev/reference/react/useState#storing-information-from-previous-renders)"
pattern: guarded by `user !== base` so it can't loop, and updating only *this*
component's own state. `use(promise)` returns a new `data` reference only when the
entry actually re-read, so the reset fires on a real remote change — including
switching to a different `id` — not on every render.

This makes **remote updates win**: an in-flight refresh replaces the draft. That is
what you want right after saving and invalidating. If instead you want to *keep*
edits across background refreshes, gate the reset (e.g. only when the form is not
dirty), or only `invalidate` once the save has completed. To reset *all* local
state when you switch records, the coarser alternative is to re-key the component
(`<EditUser key={id} />`).

**Either way, converge on save:** write to the API, then `lane.set(key, confirmed)`
(publish the returned entity) or `lane.invalidate(key)` (re-read). The draft is now
redundant — discard it. **Never** write the draft *into* Lane to "share" it;
optimistic display elsewhere is `useOptimistic`, local to the action.

## Reimplementing refetching

**Don't** hand-roll a `focus` / `reconnect` listener to revalidate, or mirror
refetch status into `useState` / `useEffect`.

**Do** use the read/instance options for revalidation and freshness:
`refetchOnFocus`, `refetchOnMount`, `refetchOnReconnect`, `staleTime`,
`whenStale`, and `gcTime`. See
[lifecycle behavior](./api-reference.md#lifecycle-behavior).

**Polling is userland** — there is no `refetchInterval` in core. A poll is a
self-scheduled invalidation, written with primitives (the same stance Lane takes
on mutations): `lane.invalidate(key, { onlyIf: "settled", background: true })` on
an interval, or an effect that re-arms after each `use(promise)` load so it never
fires mid-flight. It converges through the background transition
(`isBackgroundPending`). See [polling](./api-reference.md#polling).

## So when *do* you call `useState` / `setState`?

For **local UI state**, which Lane has no opinion about:

- form inputs and controlled components, toggles, modal/disclosure state, the
  selected tab — the search box's text *before* it becomes a key
- `useOptimistic` / `useActionState` for a mutation's optimistic value and pending
  state
- `useTransition` / `useDeferredValue` to drive transitions

Rule of thumb: **never put fetched or async data in `useState`.** If a value came
from (or derives from) a Lane read, read it with `use(promise)` and let
invalidation — not `setState` — update it.

## See also

- [Design notes](./design-notes.md) — the reasoning behind these rules.
- [API reference](./api-reference.md) — exact signatures and options.
- [Supported architectures](./architectures.md) — who owns mutations and optimistic state.
