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

One panel, one key, and the controls that make a failure reproducible:

The page is two regions, and which region an operation comes from is most of
what its outcome means.

**options** — outside the lane, and outliving it:

- **failure: never | always** — read by the loader at the start of each call.
  Values are `v1, v2, …` with a fixed 500ms delay.
- **whenStale: revalidate | refetch** and **staleTime: none | 0 | 5s** — passed
  straight to the read. `none` is an absent `staleTime`, which is `Infinity`;
  pairing it with `refetch` warns in development, and issue #80's footnote is
  about what that warning gets wrong for a rejected cache.
- **triggers: refetchOnMount / refetchOnFocus** — the other mechanism: a refresh
  fired from an effect rather than a decision the read makes. Both are gated by
  `staleTime` too. Focus fires on a tab switch, throttled to 5s by the provider;
  `refetchOnReconnect` is left out because it cannot be provoked by hand.
- **gcTime: infinity | 5s** — the only option here that is not a read's. It goes
  to `createLane`, so it is read once, when a world is built: change it and
  Reload. The default is what the rig depends on (above).
- **world: Reload** — a new lane, a new counter, the subtree remounted. The
  options are untouched, so a recipe can be run again *with the settings it was
  run with*, which a browser reload cannot do.

**lane #n** — the `LaneProvider` and everything under it, thrown away by Reload:

- **key `["lab"]`: Invalidate / Remove** — what the store is told, addressed by
  key. Remove is what reaches a first-load failure: once the key holds a value,
  the default `whenStale: "revalidate"` keeps serving it and flipping the switch
  changes nothing.
- **Reset / Reset(Invalidate) / Reset(Remove)**, inside the error frame — what
  the app does about an error it caught, where an app would put it: in the
  fallback, so it exists only while there is something to reset. All three
  clear the boundary; two of them touch the store first. That is the `onReset`
  axis, as three buttons rather than a mode to arm. `resetKey` is still fixed at
  "none" and needs the promise handed to a child.
- **reader: mounted** — whether the reader is on screen, which is also whether
  the key has a subscriber.
- **loader calls** — the counter that says whether anything ran at all.

The panel itself is the naive implementation pattern, fixed for now: `useLane`
and `use` in one component, wholly under the boundary. It renders `refreshError`
inline — the frame turns amber and keeps its value, with the error on the ⚠ as a
tooltip. Throwing it instead is the other half of that axis, and comes later.

No expected outcomes here — that is the whole point. The recipe, and what to
watch while running it (the box, and the counter):

1. Land on the page (failure = never) — that is the positive control.
2. failure = always, then **Remove**.
3. **Reset**.
4. failure = never, then **Reset** again.
5. Uncheck and recheck **mount**.
6. **Reload** to start over — the switches stay where you put them.

That is the first half of Q1 in
[issue #80](https://github.com/KentoMoriwaki/lane/issues/80): *is a Reset that
only clears allowed to be stuck?* What you see goes in the issue, not here.

## Not here yet

Added one at a time, each on its own: the promise's short id, `onReset` with
invalidate / remove, the "hand the promise to a child" pattern with
`resetKey={promise}`, the read options (`whenStale` / `staleTime` /
`refetchOnMount` / `refetchOnFocus`), the second panel and the shared-key
toggle, the roommate, `refreshError` as a throw, and the Q1–Q5 recipes.

`retry` is not among them: it was removed from the library in 049e252
("request-level policy is the fetcher's"), so the axis issue #80 lists no longer
exists.
