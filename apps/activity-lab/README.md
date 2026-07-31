# Activity Lab

Observation rig for `use-lane` under React `<Activity>` (P1: hydration, P2:
invalidate/remove while hidden) and the Next.js router bfcache (P3). The lab
carries **no expected outcomes** — scenarios exist to be reproduced in one
click and read from the Timeline / FrameStrip; findings go to
[`OBSERVATIONS.md`](./OBSERVATIONS.md).

## Run

```sh
pnpm install
pnpm --filter @lane/activity-lab dev   # http://localhost:3007
```

- `cacheComponents: true` is always on (it is what engages the router bfcache
  `<Activity>` keep-alive).
- `LAB_PARTIAL_PREFETCH=0 pnpm --filter @lane/activity-lab dev` turns
  `experimental.partialPrefetching` off; any other value (or unset) keeps it on.
- Append `?strict=1` to any URL, or use the header toggle, to wrap the tree in
  `<StrictMode>`. The flag is applied just after hydration, so the tree remounts
  once when it is on — clear the Timeline before observing.

## Pages

| Page | What it observes |
| --- | --- |
| `/smoke` | Kit smoke test: one Probe in a LabActivity, hide/reveal, Timeline |
| `/matrix` | Hydration x Activity 2x2 with a broadcast operation panel (WS2) |
| `/router-sim` | Simulated route keep-alive with snapshot re-publish (WS3) |
| `/bfcache` | Real Next.js navigation / router bfcache (WS4) |

## Comparing main against PR #62

The lab lives on a `main`-based branch and only touches `apps/activity-lab/`
plus one entry in `pnpm-workspace.yaml`, so it rebases cleanly onto the
candidate implementation:

```sh
# 1. Baseline: the lab on main's lane
git switch lab/activity-lab
pnpm install
pnpm --filter @lane/activity-lab dev

# 2. Candidate: the same lab commits on top of PR #62
git switch -c lab/activity-lab-on-62 lab/activity-lab
git rebase claude/activity-hidden-invalidate-remove-vwqeep
pnpm install
pnpm --filter @lane/activity-lab dev
```

Run the same scenario on both branches and record each column of the
`OBSERVATIONS.md` table separately. `use-lane` is consumed from `workspace:*`
source (and is in `transpilePackages`), so whatever `packages/lane` the branch
holds is what the lab exercises — no rebuild step.

## Measurement kit (`src/lab/`)

- `log.ts` — `labLog` singleton (`push` / `clear` / `subscribe` / `snapshot`)
- `timeline.tsx` — `<Timeline channels>` commit-clustered event view; keep it
  **outside** every Activity boundary
- `frame-recorder.tsx` — `useFrameRecorder(ref, { flag })` + `<FrameStrip>`:
  per-frame DOM text/display recording, flagged frames in red
- `loader.ts` — `createLabLoader(name)`: manual/auto controllable loader with
  versioned values `v1, v2, …`
- `probe.tsx` — `<Probe>` / `<MemoProbe>` / `<ProbeAll>` readers with lifecycle
  logging and a loud Suspense fallback
- `shells.tsx` — `<LabActivity variant="opaque" | "instrumented">` +
  `useLabVisibility()`
- `agitator.tsx` — `createAgitator` + `<RenderAgitator>` /
  `<AgitatorTickProvider>` / `<AgitatorControls>`: induce renders in a chosen
  lane (urgent / flushSync / transition / contextTick)
