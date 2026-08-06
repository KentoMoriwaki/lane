# Error Lab

A bench for **deciding** use-lane's error-handling spec, not for checking the
one it has. The unit tests (`core-when-stale.test.ts`, `core-stale-on-error.test.ts`)
own the logic; this app exists to answer "what would this app pattern, with
these read options, actually do?" while you change both and watch.

It is not activity-lab: no kit, no Timeline, no production-build rule.

```sh
pnpm --filter @lane/error-lab dev   # http://localhost:3008
```

Two rules the rig depends on, both already in the code:

- **StrictMode is off** (`reactStrictMode: false`). A double mount makes loader
  calls and subscriber counts unreadable.
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
  reaches a first-load failure: once a key holds a value, the default
  `whenStale: "revalidate"` keeps serving it and flipping the switch changes
  nothing. Two keys is what makes "somebody else is reading this one" an
  arrangement rather than a special case.

**the cards** — one per variation, in a grid, each a whole reader of its own:

- **integrated | separated** — where `useLane` sits relative to the boundary,
  which is what decides what a throw takes with it. `integrated` is `useLane`
  and `use` in one component under the boundary; `separated` is `useLane` above
  it, handing the promise to a child. Two cards on one key, one of each, is the
  comparison this lab was built for.
- **key A | B** — which key this card reads. Two cards on the same key are two
  subscribers of it.
- **whenStale / staleTime / onMount / onFocus** — this card's read options.
  `none` is an absent `staleTime`, which is `Infinity`; pairing it with
  `refetch` warns in development, and issue #80's footnote is about what that
  warning gets wrong for a rejected cache. The triggers are gated by `staleTime`
  too, and fire from an effect rather than from the read. Focus fires on a tab
  switch, throttled to 5s by the provider; `refetchOnReconnect` is left out
  because it cannot be provoked by hand.
- **mounted** — whether this reader is on screen, which is also whether it is
  one of the key's subscribers.
- **Retry**, inside the error frame — where an app would put it: in the
  fallback, so it exists only while there is something to reset. It is wired to
  nothing on this card. The failed read threw a `LaneReadError` carrying its
  key, and the lane is a context read away, so the fallback invalidates what
  failed without being told what it was reading. Store first, then the
  boundary's own clear.

`refreshError` is rendered inline: the frame turns amber and keeps its value,
with the error on the ⚠ as a tooltip — and unwrapped, because a reader still
holding its own `invalidate` has nothing to be carried. The two pending flags are the frame's
edges — explicit on top, background underneath. `separated` always hands the
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

That is Q1 and the front of Q2 in
[issue #80](https://github.com/KentoMoriwaki/lane/issues/80): *is a Reset that
only clears allowed to be stuck, and what should another reader change about
it?* What you see goes in the issue, not here.

## Not here yet

Added one at a time, each on its own: the promise's short id, a roommate that
owns a key without consuming it, failure injected for just the next call,
`refreshError` as a throw, and the Q1–Q5 recipes.

`retry` is not among them: it was removed from the library in 049e252
("request-level policy is the fetcher's"), so the axis issue #80 lists no longer
exists.
