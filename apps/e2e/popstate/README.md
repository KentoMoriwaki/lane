# Mount refetch / native popstate regression

Run from the repository root:

```sh
pnpm --filter @lane/e2e e2e:popstate
REACT_MODE=production pnpm --filter @lane/e2e e2e:popstate
```

The standalone server bundles workspace Lane source with React 19.2.8,
React DOM 19.2.8, and React Router 8.3.1. A single LaneProvider sits above a
declarative HashRouter with Routes/Route/Outlet. It uses only in-memory data;
there is no Electron, Next server, external API, or persistent user storage.

The loader waits 300 ms. Tests change its source while Tasks is absent, then
use Playwright's native `goBack()` / `goForward()`. They check actual popstate
delivery, completed reads, and the latest rendered value. Warm restoration
samples visible fallback elements at every `requestAnimationFrame`, starting
before traversal and continuing beyond data convergence. Frame counts are not
fixed timing expectations: the warm case requires zero fallback frames and a
nonzero number of sampled frames.

## Before / after evidence (2026-09-09, Chromium on UM890)

The first six tests were created and run before changing `use-lane.ts`:

- Warm Back failed all five variants: ordinary unmount, Activity, StrictMode,
  Activity + StrictMode + multiple readers, and multiple readers. The ordinary
  unmount run sampled 18 fallback frames (diagnostic only, not an expected count).
- The cold-mount / warm-PUSH control passed.

After moving the entire mount invalidation to a separate task, those five
warm cases passed with zero fallback frames and exactly one completed reload
per Back, including the latest source value. Additional cases cover warm
Forward into Tasks, rapid traversal during a pending read, and disabling mount
refetch. CI runs the suite against both development and production React.

`packages/lane/src/__tests__/mount-refetch.test.ts` separately controls the task
boundary with fake timers. It covers cancellation on unmount, gating, key/lane
switch and Activity hide; StrictMode and fast sibling-loader dedupe; current
options; and supersession by set/update/invalidate/focus before the task runs.

## Scope

The fix keeps a settled warm promise available through the mounting task. It
does not guarantee no fallback for cold reads, invalidated entries, a return
while the replacement is still pending, or the router's own suspending work.
The rapid-traversal tests verify convergence and no further loads after leaving;
they deliberately do not impose the settled-cache guarantee on a pending cache.

React issue [#35966](https://github.com/react/react/issues/35966) and proposed
fix [#36883](https://github.com/react/react/pull/36883/files) describe the
synthetic SyncLane / transition-only classification issue. The latter was open
and unreviewed when checked. React DOM 19.2.8 still contains the SyncLane bit
addition and the RootSuspendedWithDelay transition-only check. This test proves
the Lane regression and its task-boundary fix; it does not trace React's lanes
or apply the upstream patch for an A/B comparison. Cockpit and Electron were
not modified or retested here.
