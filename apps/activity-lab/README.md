# Activity Lab

A measurement rig, not a test suite. `packages/lane`'s unit tests and the E2E
suite already guarantee the library's logic; this app exists for the two things
they structurally cannot check:

1. **Real physics.** Streaming SSR chunk order, whether a frame was actually
   *painted* (rAF-verified, not "was committed"), and real garbage collection of
   values held through `WeakRef`. A jsdom test can assert that a fallback was
   committed; only a browser can tell you it was never on screen.
2. **Version-specific facts about React and Next.** The `<Activity>` keep-alive
   budget, when the router evicts a hidden tree, whether a reveal re-supplies its
   payload, and whether the unhide commit still re-creates layout effects in the
   same task. None of that is API surface — it is behavior that can change in a
   patch release, silently, and take Lane's reveal guarantees with it.

So the lab is what you re-run **when React or Next is upgraded**, and when
picking up the measurement debt tracked in issue #67 (the `/matrix` m8 and m18
items). It carries no expected outcomes: scenes exist to be reproduced and read
off the Timeline / FrameStrip, and what was seen goes in
[`OBSERVATIONS.md`](./OBSERVATIONS.md).

## How to run it — production build, always

```sh
rm -rf apps/activity-lab/.next
pnpm --filter @lane/activity-lab exec next build
pnpm --filter @lane/activity-lab exec next start -p 3007
```

Four rules, each one learned by getting a wrong answer first:

- **Never measure in `next dev`.** Dev re-streams the RSC payload on every
  revisit, so every route looks like it republishes and the whole "payload
  arrives / payload does not arrive" axis disappears. `pnpm dev` is for editing
  scenes, not for reading results.
- **`rm -rf .next` after switching branches or touching `packages/lane`.** The
  build cache keeps a stale copy of the workspace package, and you will measure
  the old library while reading the new source.
- **Measure in a visible browser window.** A hidden or backgrounded tab
  (including an editor's embedded browser pane) does not tick
  `requestAnimationFrame`, so every paint check silently reports zero, and PPR's
  dynamic holes never hydrate — which shows up as an `external` read timing out
  on a route that does publish. Playwright's headless Chromium counts as visible;
  an inactive tab does not.
- **Port 3007 tends to hold a previous run.** `kill $(lsof -ti :3007)`.

Options: `cacheComponents: true` is always on (it is what engages the router
bfcache `<Activity>` keep-alive). `LAB_PARTIAL_PREFETCH=0` turns
`experimental.partialPrefetching` off. Append `?strict=1` to any URL, or use the
header toggle, to wrap the tree in `<StrictMode>` — the flag applies just after
hydration, so the tree remounts once when it is on; clear the Timeline before
observing.

## Scenes

| Scene | What it pins | What breaking looks like |
| --- | --- | --- |
| `/outside-reader` | The physics of an `external` read: a reader outside every `<LaneHydration>` boundary suspends on the server and resolves *during SSR* when the publish lands; soft navigation between publishing routes converges with zero painted fallback frames; a plain back re-renders nothing and keeps the last publication; an unpublished key sits for 10s and rejects with a key-named `LaneExternalTimeoutError`; published values are reclaimed one generation behind the router's payload. | The value appearing in the HTML *before* the publish chunk, or not at all (a `$RX` bailout on a publishing route). A painted fallback frame during soft nav. A back navigation that re-renders or falls back. Values never collected (retention leak) — or collected while the payload is still live (premature). |
| `/reveal-sync` | **The React-upgrade detector.** That unhide and the re-appearance of layout effects happen in the *same task*, which is the whole basis for correcting a reveal before paint. Contrasts a passive-only reader against one with the layout reconciliation. | The recorder shows a painted frame carrying the pre-reveal value. That means the correction is racing paint instead of preceding it, and `useLane`'s reveal reconciliation has to be re-derived. |
| `/bfcache` | **The Next-upgrade detector.** Real router navigation under `cacheComponents`: which trees are kept alive and for how long, whether a revisit re-streams the payload (dynamic vs static vs `"use cache"` routes), and what a reveal shows when the lane layer and the Next layer are invalidated independently — the HUD fires each separately. Snapshot identity probes separate "a new payload" from "the same payload again". Split by ownership: every route mounts **published** keys (`loader: external`, seeded by the route, no loader to fire — a restore asks whether the seed is still reachable) beside a **client-owned** key (never seeded, browser-fetched — a restore asks whether the loader runs again), so one return reads both. | Loader calls on a reveal that used to have none — and they can only come from the client-owned probe. A published probe that starts waiting (its value was collected and nothing republished). Red frames in the FrameStrip (a repudiated value on screen). A route that used to republish on revisit going silent, or the keep-alive budget changing. |
| `/matrix` | Hydration × Activity as a 2×2 (P / A / H / AH quadrants, independent lanes, one broadcast operation panel) with an in-page scenario runner. This is where issue #67's remaining debt lives: m8 (a stuck transition blocking later reveal convergence) and m18 (StrictMode). | Quadrants disagreeing where they previously matched, or a scenario that used to converge stalling. |

`/smoke` and `/router-sim` were removed when the lab was trimmed to this core:
the first was a kit self-test that the four scenes above exercise in passing, the
second a hand-rolled router built to explore owner-supplied visibility/epoch
signals — an approach the shipped design replaced (the reveal reconciliation in
[#64] and `external` in [#65]).

## Records

- [`OBSERVATIONS.md`](./OBSERVATIONS.md) — the measurement log and the design
  reasoning it produced. **Append-only, and deliberately not rewritten**: it is a
  historical record, so it cites scenes that no longer exist (`/smoke`,
  `/router-sim`) and describes branches and candidate implementations that were
  never merged. Read it as a lab notebook, not as documentation of the current
  rig.
- [`RESEARCH-next-router-caches.md`](./RESEARCH-next-router-caches.md) — a
  source-level reading of the App Router's client caches (Next 16.3.0-preview.10)
  backing the retention design. Equally frozen: it is accurate about that
  version, which is exactly its value when comparing against a newer one.

The published guidance those records led to lives in the repo docs — the
ownership rule in [`docs/architectures.md`](../../docs/architectures.md), the
Activity behavior and its limits in
[`docs/consistency.md`](../../docs/consistency.md) and
[`docs/integrations.md`](../../docs/integrations.md).

## Measurement kit (`src/lab/`)

- `log.ts` — `labLog` singleton (`push` / `clear` / `subscribe` / `snapshot`)
- `timeline.tsx` — `<Timeline channels>` commit-clustered event view; keep it
  **outside** every Activity boundary
- `frame-recorder.tsx` — `useFrameRecorder(ref, { flag })` + `<FrameStrip>`:
  per-frame DOM text/display recording with rAF counts, flagged frames in red
- `loader.ts` — `createLabLoader(name)`: manual/auto controllable loader with
  versioned values `v1, v2, …`
- `probe.tsx` — `<Probe>` / `<MemoProbe>` / `<ProbeAll>` readers with lifecycle
  logging and a loud Suspense fallback
- `shells.tsx` — `<LabActivity variant="opaque" | "instrumented">` +
  `useLabVisibility()`
- `agitator.tsx` — `createAgitator` + `<RenderAgitator>` /
  `<AgitatorTickProvider>` / `<AgitatorControls>`: induce renders in a chosen
  lane (urgent / flushSync / transition / contextTick)

Two rules the kit has already cost a session each: put the recorder **outside**
the Activity boundary (inside, its attach effect is destroyed by the hide and the
reveal window goes unrecorded), and subscribe HUD state at a **leaf** with the
reader memoized — a HUD that re-renders the reader it observes loops.

[#64]: https://github.com/KentoMoriwaki/lane/pull/64
[#65]: https://github.com/KentoMoriwaki/lane/pull/65
