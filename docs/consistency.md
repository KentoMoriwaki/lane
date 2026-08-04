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

**Readers of one key agree on which pending flag is set.** A reader that
subscribes a moment too late to receive a notification still converges through
the same kind of transition it missed, so it reports `isInvalidationPending` or
`isBackgroundPending` to match its siblings rather than always the latter.

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
store's if they differ. Three outcomes, all decided by what the store holds
rather than by what happened while hidden:

| Store state at the reveal | What the first revealed frame shows |
| --- | --- |
| the same promise the reader holds | that value, immediately — no work, no request |
| a settled replacement (a publication, a sibling's finished read) | the replacement, adopted synchronously |
| repudiated or absent (invalidated, removed) | the boundary's fallback, with the re-read starting *at* the reveal |

The last row is the guarantee worth stating plainly: **a repudiated value is
never painted.** The correction happens in the same task as the unhide, and the
browser does not paint mid-task, so there is no frame in which the old value is
on screen.

**A reveal that carries a publication skips even the fallback.** When the reveal
re-renders the tree under a new publication — an App Router navigation that
re-streams the payload — readers adopt the new seed during that render, inside the
navigation's transition, and the whole thing commits once. That is what keeps a
framework's "fetch, then reveal" intact instead of converting resolved data into a
loading state.

Per ownership, in one line each:

- **[Published keys](./api-reference.md#external--a-read-the-owner-publishes)** —
  a reveal that carries a republication converges in that render; one that does
  not shows what the tree held. Retention needs no `gcTime` tuning because it is
  [reachability](./api-reference.md#external-retention): as long as the framework
  holds the payload or a committed reader holds the promise, the value is there.
- **Client-owned keys** — converge through notifications while visible, and
  through the reveal reconciliation for everything missed while hidden. Retention
  is `gcTime`: if the entry was collected while the tree was hidden, the reveal
  re-reads through the loader and falls back until it lands.

#### Flash-free reveals: the promise has to have been `use()`d

React tags a promise's status the first time `use()` sees it. Until then it has
to suspend once, even if the promise is already resolved, before it can replay
with the value. So an adoption at a reveal repaints without a fallback **only if
the promise being adopted has been through `use()` at least once** — which is
true of anything a reader has already rendered, and of anything a sibling reader
resolved while the tree was hidden.

The practical corollary is about warming: `lane.prefetch` runs outside React, so
a prefetched-and-never-read promise is untagged, and the first `use()` of it
suspends for one retry. Warming still saves the request; it does not by itself
buy a flash-free first frame. If a surface must appear complete on reveal, have
something read the key (even a hidden `<Activity>` reader) rather than only
prefetching it.

In measurement, that one retry has been transient enough not to reach the screen —
in the lab's App Router scene the fallback it produces was committed but never
painted. Do not lean on that: it is a race that a slower reveal commit can lose,
whereas a promise that has already been read cannot suspend at all.

> **Footnote — holding a frame during adoption.** If a specific surface must not
> risk even that retry, the userland pattern is to keep the outgoing content
> mounted for one commit while the adopted promise is instrumented (a "flash
> guard" wrapper around the boundary). Lane ships nothing for this and the lab has
> not measured a form of it; it is named here so the option is known, not
> recommended as a default.

### Announce pending at the start of a mutation, not the end

*(Client-owned keys. A published key converges when its owner republishes, so the
mutation's own transition — the Server Action, the router revalidation — is
already the pending signal.)*

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
   every reader as `refreshError`.
2. **You can show the outcome before it lands** → `useOptimistic`. The reader
   already shows the new state, so pending is not the right signal at all.
3. **Neither** → [`startInvalidationTransition`](./api-reference.md#startinvalidationtransition--pending-from-the-start-of-an-action),
   for the action that refreshes a list, a counter, and a detail view it returns
   none of. Run the action in the reader's transition and name the other keys
   that should look busy; they are announced in the same synchronous fan-out, so
   the whole set goes pending in one tick and converges in one commit:

```ts
startInvalidationTransition([["counters"]], async () => {
  await saveTodo(patch);
  invalidate();
  lane.invalidate(["counters"]);
});
```

[`invalidate(key, { after })`](./api-reference.md#announcing-an-invalidation-before-the-mutation-finishes)
reaches the same window by handing Lane the action's promise as a clock instead.
It predates the transition form and costs one thing that form does not: the
promise is Lane's to observe, so a rejected action still converges and its
failure never surfaces through Lane.

None of this is a default to apply everywhere. When the pending signal is
already where the user is looking — a submit button on `useActionState` — and
the affected reads are elsewhere, the plain shape above is the right one. See
[when to reach for it](./api-reference.md#when-to-reach-for-it) for the rest,
including the one place `after` costs you something.

### Let readers of one key agree on freshness

`whenStale` and `staleTime` are read-time options, and the read that the store
keeps is the one that happens first. Readers of the same key that disagree about
them get a policy decided by mount order, which is a predictability problem well
before it is a consistency one. Share the options object, or derive it from one
place.

A [published key](./api-reference.md#external--a-read-the-owner-publishes) cannot
have this problem: its read spec carries no freshness options at all, so every
reader of it agrees by construction, and the publication is what changes the
value for all of them at once.

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
repaired one commit later still fails the test. It covers both entry points for
the inconsistent case, the same-transition control that removes them, and the
guarantees at the top of this page — including the one that says an ordinary
invalidate → refetch is safe on its own.

`transition-entanglement.test.ts` pins the half of the shared-lane claim that
reaches *outside* Lane, because it is what decides whether keeping readers
pending across a mutation needs machinery at all. A reader invalidated from
inside `startTransition(async () => …)` joins that transition rather than
opening one of its own, so the caller stays pending until the reader has its
new data — after its own action has already settled. The second case records
the React behavior behind that: an empty `startTransition`, with no update to
schedule, still reports pending for as long as the enclosing scope runs,
because `isPending` is itself transition-lane state and its reset is entangled
with everything else in the lane.

## See also

- [Design notes](./design-notes.md) — why Lane is transition-native by
  construction.
- [Transitions, and the back/forward caveat](./integrations.md#transitions-and-the-backforward-caveat)
  — the routing side of the same trade.
- [Common mistakes](./common-mistakes.md) — the anti-patterns, in detail.
