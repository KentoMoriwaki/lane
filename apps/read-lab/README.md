# Read Lab

A bench for watching what a read does over its life — failing, waiting, being
collected, coming back — while you change how the app is written and how the read
is configured. It exists to **decide** things, not to check what is already
decided: the unit tests own the logic, and this answers "what would this pattern,
with these options, actually do?"

It started as `error-lab`, for [issue #80](https://github.com/KentoMoriwaki/lane/issues/80)'s
error-handling questions, and outgrew the name. Deciding those questions turned
out to mean touching retention (`gcTime`, `warmTime`), freshness (`staleTime` and
the triggers), what a throw takes with it, and what React does to a reader across
a reveal — which is the same subject seen from four sides: **a read, and the
entry behind it, over time.**

It is not activity-lab: no kit, no Timeline, no production-build rule. That one
measures React and Next themselves; this one exercises Lane against them.

```sh
pnpm --filter @lane/read-lab dev   # http://localhost:3008
```

Two rules the rig depends on, both already in the code:

- **StrictMode is on** (Next's default). It was off at first, on the assumption
  that a double mount makes the loader count unreadable — it does not: the second
  render reuses the cache, and subscribe → cleanup → subscribe leaves the entry
  held. A doubled count here is a finding, not noise, and this is the only place
  to watch React actually keep "leaving and coming back in one task is not
  leaving".
- **The lane is `gcTime: Infinity` by default.** The 5-minute default would
  collect a rejected entry on its own, and "it recovered" would stop meaning
  anything. The `5s` setting is the deliberate opposite, for watching an idle
  entry go; the lane header prints which one it was built with.

And one rule to keep: **instruments never subscribe to the lane.** Even
`onInvalidate` / `onRemove` land in `entry.subscribers`, which is the gate being
observed.

## Where it is now

Three layers, and which layer an operation comes from is most of what its
outcome means.

**options** — outside the lane, and outliving it. What the loaders do and how
the store is built; nothing a single read decides:

- **failure: never | always** — read by each loader at the start of each call.
  Values are `v1, v2, …` per key, with a fixed 500ms delay.
- **gcTime: infinity | 5s** — goes to `createLane`, so it is read once, when a
  world is built: change it and Reload. The default is what the rig depends on
  (above), and the lane header prints what it was actually built with.
- **Reload** — a new lane, new counters, the cards remounted. The options *and
  the cards* are untouched, so an arrangement can be run again exactly as it was
  set up, which a browser reload cannot do.
- **Add variation** — another card.

**lane #n** — the `LaneProvider` and everything under it, thrown away by Reload:

- **key A / key B: Invalidate / Remove**, with that key's loader count — what
  the store is told, addressed by key rather than by reader. Remove is what
  reaches a first-load failure: once a key holds a value, a read serves it and
  flipping the switch changes nothing — reads never take anything away. Two keys
  is what makes "somebody else is reading this one" an arrangement rather than a
  special case.

**the cards** — one per variation, in a grid, each a whole reader of its own:

- **integrated | separated** — where `useLane` sits relative to the boundary,
  which is what decides what a throw takes with it. `integrated` is `useLane`
  and `use` in one component under the boundary; `separated` is `useLane` above
  it, handing the promise to a child. Two cards on one key, one of each, is the
  comparison this lab was built for.
- **key A | B** — which key this card reads. Two cards on the same key are two
  subscribers of it.
- **gcTime / warmTime / staleTime / onMount / onFocus** — this card's read
  options. `gcTime` is what its value is worth once *it* stops holding it: `0`
  makes every remount a fresh load (which suspends, because the entry is gone).
  `warmTime` is the other side of the same coin — how long the value waits for a
  reader who never arrived, which is what an unmount *during* the load leaves
  behind. `lane` defers to the instance policy for either. `staleTime` plus the
  triggers is freshness while a reader is mounted: refreshing what is on screen,
  underneath it, from an effect. `none` is an absent `staleTime`, which is
  `Infinity`, so the triggers are on and silent and development says so. Focus
  fires on a tab switch, throttled to 5s by the provider; `refetchOnReconnect` is
  left out because it cannot be provoked by hand.
- **fallback: none | previous | empty | throw** — this read's own policy for
  what a failed load serves, which decides whether a failure reaches the
  boundary at all. `none` leaves the built-in one in place: a failure over data
  serves the previous value, a *first* failure rejects. `previous` is that with
  a floor — `({ lastFulfilled }) => lastFulfilled ?? "(empty)"` — so the card
  never reaches a boundary, and the difference shows up on the first failure of
  a fresh world. `empty` always serves the substitute, which is the mistake
  worth seeing: a refresh failure over real data replaces what was on screen,
  exactly as a `try`/`catch` in the loader would, and just as quietly. `throw`
  refuses to serve a value that is not current, so a failure hits the boundary
  whether or not there is a previous value — the one policy the built-in
  behaviour cannot express.

  With two cards on one key, the policy that runs is the one carried by the
  read that *started the load*. Give the first card `previous` and the second
  `throw` — two policies with visibly different outcomes on the same failure —
  unmount the second, set failure to `always`, Reload, then mount it. It shows
  `(empty)`, not the boundary its own policy asked for: it adopted a settled
  cache, and the settlement had already been decided.

- **error: inline | throw** — what the card does with a failed refresh
  over data it is still showing. `inline` renders both. `throw` hands it to the
  boundary. The frame carries a text input for this axis: whatever is typed into
  it is the local state a throw destroys.
- **mounted** — whether this reader is on screen, which is also whether it is
  one of the key's subscribers.
- **Retry**, inside the error frame — where an app would put it: in the
  fallback, so it exists only while there is something to reset. It is wired to
  nothing on this card. The failed read threw a `LaneReadError` carrying its
  key, and the lane is a context read away, so the fallback invalidates what
  failed without being told what it was reading. Store first, then the
  boundary's own clear.

`error` arrives unwrapped, because a reader still holding its own
`invalidate` has nothing to be carried. Rendered inline it turns the frame amber
and keeps the value, with the error on the ⚠ as a tooltip; thrown, it reaches the
boundary as the loader left it — an error with no key on it. The two pending flags
are the frame's edges — explicit on top, background underneath. `separated` always hands the
boundary `resetKey={promise}`; there is no knob for leaving it off, because
that is a bug in an app rather than an arrangement worth reproducing.

No expected outcomes here — that is the whole point. A recipe, and what to watch
while running it (the frames, and the counters):

1. Land on the page (failure = never) — that is the positive control.
2. failure = always, then **Remove** on that card's key.
3. **Retry**.
4. Add a second card on the same key, one integrated and one separated, and run
   2–3 again with both up.
5. Uncheck **mounted** on one of them and run it again.
6. **Reload** to start over — the switches and the cards stay where you put them.

And for what a thrown `error` costs (Q3):

1. failure = never, and let a card reach its value.
2. Type something into the frame's input.
3. failure = always, then **Invalidate** on that card's key — watch the input.
4. Set that card's **error** to `throw` and do 1–3 again.
5. With it thrown, try to get back: **Retry**, then the key's **Invalidate**,
   then **Remove**.

That is Q1 and the front of Q2 in
[issue #80](https://github.com/KentoMoriwaki/lane/issues/80): *is a Reset that
only clears allowed to be stuck, and what should another reader change about
it?* What you see goes in the issue, not here.

## Not here yet

Added one at a time, each on its own: the promise's short id, a roommate that
owns a key without consuming it, failure injected for just the next call,
`error` as a throw, and the Q1–Q5 recipes.

`retry` is not among them: it was removed from the library in 049e252
("request-level policy is the fetcher's"), so the axis issue #80 lists no longer
exists.
