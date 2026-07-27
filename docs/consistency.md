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
the same kind of transition it missed, so it reports `isTransitionPending` or
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

### Announce pending at the start of a mutation, not the end

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
   action, and there is no second round-trip.
2. **You can show the outcome before it lands** → `useOptimistic`. The reader
   already shows the new state, so pending is not the right signal at all.
3. **Neither** → [`invalidate(key, { after })`](./api-reference.md#announcing-an-invalidation-before-the-mutation-finishes),
   for the action that refreshes a list, a counter, and a detail view it returns
   none of:

```ts
const saved = saveTodo(patch);
lane.invalidateAll(["todos"], { after: saved });
await saved;
```

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

## See also

- [Design notes](./design-notes.md) — why Lane is transition-native by
  construction.
- [Transitions, and the back/forward caveat](./integrations.md#transitions-and-the-backforward-caveat)
  — the routing side of the same trade.
- [Common mistakes](./common-mistakes.md) — the anti-patterns, in detail.
