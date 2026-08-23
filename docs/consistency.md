# Cross-reader consistency

What two components reading the same key are guaranteed to show each other, and
the one arrangement where they can disagree.

Lane keeps each key's promise in `useState` + `useTransition` rather than in a
`useSyncExternalStore` read during render. That is what makes it
transition-native — a suspending read holds the previous screen instead of
forcing a synchronous fallback (see [Transitions, and the back/forward
caveat](./integrations.md#transitions-and-the-backforward-caveat)). The trade is
that Lane converges readers *after* a commit rather than preventing an
inconsistent one.

In practice that window is much narrower than "no synchronous consistency"
suggests, and this page states it exactly, because the difference decides what
you have to do about it.

## What holds

**Subscribed readers of one key converge in a single commit.** Invalidation
notifies every subscriber synchronously, in one tick, so their transitions share
React's per-event transition lane and land together. No frame shows them
disagreeing.

**Readers of one key agree on which pending flag is set.** A reader subscribes
in the layout phase of the commit that mounts it — on the line after the
reconciliation that reads the store — so there is no window in which a change
reaches neither channel, and every reader of a key learns about an update from
the notification itself rather than by noticing afterwards that the store moved.
Which transition an update converges through is something only the notification
knows, so a reader that had to work it out after the fact could report
`isBackgroundPending` where its siblings report `isInvalidationPending`. None of
them has to.

**An uncommitted mount is never pinned to a superseded promise.** A suspended
fiber has not committed, so React re-runs its `useState` initializer on every
retry. Whatever the store holds at the last retry is what renders — a mount
cannot get stuck on a promise the store has moved past.

**A pending promise is absorbed by Suspense.** `use()` tags a thenable the first
time it sees one, so even a promise the store considers settled suspends the
first reader that touches it. The update is routed through Suspense, where a
transition holds the previous screen. This is why an ordinary
`invalidate` → refetch cannot produce an inconsistent frame on its own: the
reader that mounts mid-refetch waits on the very promise the mounted readers are
waiting on, and they all wake together.

## What does not

> Readers of one key can show two different values when an **urgent render-phase
> read** of that key happens while a **transition on the same key cannot commit**
> — and only for as long as that transition stays blocked.

Three things have to be true at once:

1. **A render-phase read.** Either a fresh mount, or a reader switching its
   `key` / lane / `enabled`. A reader that is already mounted converges through
   its subscription instead.
2. **The read does not suspend.** Because `use()` tags a thenable on first
   sight, this is the hard one to satisfy — it needs a promise React can already
   read synchronously.
3. **A transition on that key that cannot commit yet.** Not "the refetch is
   slow": readers waiting on the same promise wake together. It takes something
   *else* holding the transition back.

Condition 3 is what you control. It appears when a single transition does more
than one thing and one of them is slow:

```tsx
onClick={() => {
  setShowDetail(true);                    // urgent — commits on its own
  startTransition(() => {
    lane.set(["task", id], task);         // ready immediately
    lane.invalidate(["activity"]);        // slow — holds the transition back
  });
}}
```

`showDetail` commits at once, and the detail view reads `["task", id]` straight
from the store, so it shows the new task while the already-mounted readers of
that key are still on the old one — until `["activity"]` resolves. A reader
switching its key onto `["task", id]` in the same click does the same thing.

## Avoiding it

### Keep one key's update at one priority

Put the state change that causes the render-phase read — the mount, the key
switch — in the same transition as the write:

```tsx
onClick={() => {
  startTransition(() => {
    setShowDetail(true);                  // now part of the same transition
    lane.set(["task", id], task);
    lane.invalidate(["activity"]);
  });
}}
```

React now holds the previous screen until the whole thing can commit, and
everything lands together. **This alone removes both entry points.** Urgent
updates that don't cause a read of the key are irrelevant — the rule is about
splitting *one key's* update across priorities, not about avoiding urgent
updates.

### Don't create readers you don't need

Every reader of a key is another independently scheduled convergence, so the
window above only exists where a key has more than one. Reading `["task", id]`
in a parent and again in its child costs one request either way — dedupe sees to
that — but it doubles the number of things that have to agree, for data a prop
would have carried. Read where the data enters the screen and pass it down; read
the same key twice only across genuinely separate surfaces, where threading a
prop would mean routing it through components that have no business knowing
about it. See
[read a key once, then pass the value down](./common-mistakes.md#read-a-key-once-then-pass-the-value-down).

### Decide what the newly revealed content does

This is a presentation choice rather than a consistency one, but it is the one
you will notice:

- **No `<Suspense>` of its own** — the commit waits for everything, and the new
  content appears with the rest.
- **Its own `<Suspense>`** — the new content shows its fallback while the
  existing readers keep their current value.

Neither is inconsistent; they just feel different. Pick per surface.

### Under `<Activity>` and router keep-alive

<a id="activity"></a>

A hidden `<Activity>` — including the router keep-alive Next builds on it — is
the one place a reader can hold a value the store has moved past, so it gets its
own account here.

**What hiding does.** The subtree keeps its state and its DOM, which is why
revealing it is instant, and React tears down its effects, which is why the
reader stops being a subscriber. Notification is Lane's only channel to a mounted
reader, so for as long as the tree is hidden, nothing that happens in the store
reaches it. Hidden trees also keep *rendering* (a context change, a parent
re-render), and Lane deliberately does not read on those renders: reading while
hidden would fetch data that is stale again by the time anyone sees it.

**What revealing does.** A reveal re-creates layout effects inside the commit
that unhides the tree, before paint, and Lane reconciles there: it compares the
promise the reader is holding against the store's current one, and adopts the
store's if they differ. Four outcomes, all decided by what the store holds
rather than by what happened while hidden:

| Store state at the reveal | What the first revealed frame shows |
| --- | --- |
| the same promise the reader holds | that value, immediately — no work, no request |
| a replacement the store was handed as a value (a publication, a `set`) | the replacement, adopted synchronously — no fallback |
| a settled promise nothing has read yet (a finished read, a warmed prefetch) | the replacement, one suspend later — the fallback is committed first |
| invalidated or absent (removed, collected) | the boundary's fallback, with the re-read starting *at* the reveal |

The last row is the guarantee worth stating plainly: **an invalidated value is
never painted.** The correction happens in the same task as the unhide, and the
browser does not paint mid-task, so there is no frame in which the old value is
on screen.

**A reveal that carries a publication converges in the render itself.** When the
reveal re-renders the tree under a new publication — an App Router navigation that
re-streams the payload — readers adopt the new seed during that render, inside the
navigation's transition, and the whole thing commits once. That is what keeps a
framework's "fetch, then reveal" intact instead of converting resolved data into a
loading state.

Per ownership, in one line each:

- **[Published keys](./api-reference.md#external--a-read-the-owner-publishes)** —
  a reveal that carries a republication converges in that render; one that does
  not shows what the tree held. If the value is *gone* — invalidated while the
  tree was hidden, or collected with its payload — the reveal's re-read
  suspends and asks the owner through
  [`refresh`](./api-reference.md#refresh--the-owner-ask); nothing was asked
  while the tree was hidden, which is the point of deferring the ask to the
  read. Retention needs no `gcTime` tuning because it is
  [reachability](./api-reference.md#external-retention): as long as the framework
  holds the payload or a committed reader holds the promise, the value is there.
- **Client-owned keys** — converge through notifications while visible, and
  through the reveal reconciliation for everything missed while hidden. Retention
  is `gcTime`: if the entry was collected while the tree was hidden, the reveal
  re-reads through the loader and falls back until it lands.

#### Flash-free reveals: a value the store was handed, not a promise it holds

A value that reached the store synchronously — `set(key, value)`, a
`<LaneHydration>` seed — is wrapped in a promise that is already fulfilled when
it is handed back, carrying `status` and `value`
([React's promise cache protocol](https://react.dev/reference/react/use#how-to-implement-a-promise-cache))
with no microtask in between. `use()` reads it in the render that receives it,
so **a reveal that adopts one commits without a fallback** even though nothing
has ever read it. That is the case the reveal has to survive: a mutation
converged behind a hidden tree, or a navigation's payload seeding a key the tree
never saw.

A *promise* is left as it arrived. A loader's result, `set(key, promise)`, an
`update` chained onto one, `lane.prefetch` — those are somebody else's promise
passed through, and there is nothing the store can say about one synchronously.
React stamps it on its first `use()`, which is one suspend later. That is
usually invisible, because a suspend inside a transition holds the current
screen. **A reveal is not a transition**: it adopts from a layout effect, a
synchronous update with nowhere to wait, so the boundary commits its fallback
and comes back on a retry React throttles fallbacks on for ~300ms.

So warming still needs care. `lane.prefetch` runs a loader, and the promise it
leaves in the store has been read by nobody, so a synchronous reveal that adopts
it shows the fallback. Warming saves the request; it does not by itself buy a
flash-free first frame. If a surface must appear complete on reveal, either have
something read the key (a hidden `<Activity>` reader will do) or put the value in
with `set` rather than warming a loader for it.

What none of this buys is a promise that is still loading. A pending replacement
suspends, as it should: it has nothing to show, and the boundary's fallback is
the specified presentation for a new appearance.

> **Footnote — holding a frame during adoption.** If a specific surface must not
> risk that retry and cannot be served by a `set`, the userland pattern is to
> keep the outgoing content mounted for one commit while the adopted promise is
> instrumented (a "flash guard" wrapper around the boundary). Lane ships nothing
> for this and the lab has not measured a form of it; it is named here so the
> option is known, not recommended as a default.

### Announce pending at the start of a mutation, not the end

*(Every key, published or not. On a published key `invalidate` is what asks the
owner, so announcing it early buys the same thing it does anywhere else — except
after a revalidating Server Action, whose own transition is already the pending
signal and whose response already carries the new payload.)*

```ts
await saveTodo(patch);
lane.invalidateAll(["todos"]);   // readers learn about it only now
```

Notification is Lane's only channel to a reader, so this leaves every reader
showing nothing for the whole request — stale data with no sign that anything is
happening. Which tool fixes that depends on what the action gives you, in this
order:

1. **The action resolves to the key's value** → [`set(key, promise)`](./api-reference.md#set)
   publishes the in-flight promise under that key: pending starts with the
   action, and there is no second round-trip. Only for a promise of the key's
   *value* — a mutation's promise does not go here, or its failure arrives at
   every reader as `error`.
2. **You can show the outcome before it lands** → `useOptimistic`. The reader
   already shows the new state, so pending is not the right signal at all.
3. **Neither** → [`startInvalidationTransition`](./api-reference.md#startinvalidationtransition--pending-from-the-start-of-an-action),
   for the action that refreshes a list, a counter, and a detail view it returns
   none of. Run the action in the reader's transition; the other keys that should
   look busy join with `lane.startInvalidationTransition(scope)` from inside it,
   in the same synchronous fan-out, so the whole set goes pending in one tick and
   converges in one commit:

```ts
startInvalidationTransition(async () => {
  await saveTodo(patch);   // announces ["counters"] from inside, and converges it
  invalidate();
});
```

None of this is a default to apply everywhere. When the pending signal is
already where the user is looking — a submit button on `useActionState` — and
the affected reads are elsewhere, the plain shape above is the right one: a
window nobody is watching costs renders and buys nothing. See
[`startInvalidationTransition`](./api-reference.md#startinvalidationtransition--pending-from-the-start-of-an-action)
for the rest.

### Let readers of one key agree on freshness

`staleTime` and `gcTime` are the reader's, and readers of one key that disagree
about them get a policy decided by whoever acted last: the earliest trigger
refreshes for everyone, and the last reader to leave decides how long the value
outlives them all. Neither is wrong, and both are hard to predict from any one
component. Share the options object, or derive it from one place.

A [published key](./api-reference.md#external--a-read-the-owner-publishes) cannot
have this problem: its read spec carries no freshness options at all — freshness
is the owner's — so every reader of it agrees by construction, and the
publication is what changes the value for all of them at once. What a reader
*can* say is "this is stale now", explicitly, with `invalidate`; that is an
event, not a policy, and every reader of the key sees the same one.

## What not to reach for

- **Wrapping the read in `useSyncExternalStore`.** Its consistency check is a
  passive-effect snapshot comparison followed by a *synchronous* re-render. That
  is the de-opt Lane exists to avoid: it would force Suspense fallbacks during
  transitions and change how `useDeferredValue` commits downstream. It buys back
  a narrow window at the cost of the model.
- **`flushSync`.** Same de-opt, applied by hand.
- **Catching up in a layout effect.** A synchronous update before paint is still
  an urgent update: it jumps ahead of any pending transition, so it can split a
  multi-key update that was meant to be atomic.

## Where this is pinned

`packages/lane/src/__tests__/tearing.test.ts` asserts all of the above against a
log of *committed DOM frames* rather than final state, so a frame that is
repaired one commit later still fails the test.
`transition-entanglement.test.ts` pins the React behavior the pending window
relies on: a reader invalidated from inside `startTransition(async () => …)`
joins that transition rather than opening one of its own, and an empty
`startTransition` still reports pending for as long as the enclosing scope runs.

## See also

- [Design notes](./design-notes.md) — why Lane is transition-native by
  construction.
- [Transitions, and the back/forward caveat](./integrations.md#transitions-and-the-backforward-caveat)
  — the routing side of the same trade.
- [Common mistakes](./common-mistakes.md) — the anti-patterns, in detail.
