// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLane,
  LaneHydration,
  LaneProvider,
  useLane,
} from "../index";
import { serializeKey } from "../keys";
import type {
  Lane,
  LaneHydrationSnapshots,
  LaneKey,
  LaneLoader,
  LaneLoaderContext,
  LaneUseOptions,
} from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
};

const roots: Root[] = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }

  document.body.innerHTML = "";
  resetVitest();
});

describe("React integration", () => {
  it("marks explicit invalidation as transition pending", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await click(app.container, "invalidate");

    await waitForText(app.container, "cached|background:0|transition:1|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "reloaded");

    await waitForText(app.container, "reloaded|background:0|transition:0|refresh:none");
  });

  it("marks focus refetch as background pending", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchOnFocus: true,
        staleTime: 0,
      },
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached|background:1|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "focused");

    await waitForText(app.container, "focused|background:0|transition:0|refresh:none");
  });

  it("marks reconnect refetch as background pending", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchOnReconnect: true,
        staleTime: 0,
      },
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached|background:1|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "reconnected");

    await waitForText(app.container, "reconnected|background:0|transition:0|refresh:none");
  });

  it("revalidates focus subscribers when the document becomes visible", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchOnFocus: true,
        staleTime: 0,
      },
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached|background:1|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "visible");

    await waitForText(app.container, "visible|background:0|transition:0|refresh:none");
  });

  it("throttles focus revalidation and allows it again after the window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const lane = createLane();
    const first = deferred<string>();
    const second = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchOnFocus: true,
        staleTime: 0,
      },
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(first, "focused-1");
    await waitForText(app.container, "focused-1|background:0|transition:0|refresh:none");

    // Within the throttle window, focus and visibilitychange coalesce.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await settlePromiseHandlers();
    });
    expect(loader).toHaveBeenCalledTimes(1);

    vi.setSystemTime(15_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });
    expect(loader).toHaveBeenCalledTimes(2);

    await resolveReload(second, "focused-2");
    await waitForText(app.container, "focused-2|background:0|transition:0|refresh:none");
  });

  it("polls with refetchInterval as background refetches", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => "first")
      .mockImplementationOnce(() => reload.promise);

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchInterval: 1_000,
      },
    });

    await waitForText(app.container, "first|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    await waitForText(app.container, "first|background:1|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(2);

    await resolveReload(reload, "polled");

    await waitForText(app.container, "polled|background:0|transition:0|refresh:none");
  });

  it("marks refetchOnMount as background pending", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({
      lane,
      loader,
      options: {
        refetchOnMount: true,
        staleTime: 0,
      },
    });

    await waitForText(app.container, "cached|background:1|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "mounted");

    await waitForText(app.container, "mounted|background:0|transition:0|refresh:none");
  });

  it("does not immediately refetch freshly hydrated data on mount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const loader = vi.fn(async () => "reloaded");
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server" }],
    };
    const app = await render(
      hydrationApp(lane, snapshots, loader, {
        refetchOnMount: true,
        staleTime: 1_000,
      }),
    );

    await waitForText(app.container, "loading");

    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "server|background:0|transition:0|refresh:none");
    expect(loader).not.toHaveBeenCalled();
  });

  it("re-hydration with new snapshots overwrites and updates mounted readers", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "reloaded");
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-2" }],
    };

    const app = await render(hydrationApp(lane, first, loader));

    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "server-1|background:0|transition:0|refresh:none");

    await act(async () => {
      app.root.render(hydrationApp(lane, second, loader));
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "server-2|background:0|transition:0|refresh:none");
    expect(loader).not.toHaveBeenCalled();
  });

  it("converges after an invalidation lands while the initial read is suspended", async () => {
    const lane = createLane();
    const first = deferred<string>();
    const second = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const app = await renderLaneApp({ lane, loader });

    await waitForText(app.container, "loading");

    // The reader is suspended, so it has not subscribed yet. This
    // invalidation reaches no subscriber and even drops the entry.
    await act(async () => {
      lane.invalidate(["tasks"]);
      await settlePromiseHandlers();
    });

    await act(async () => {
      first.resolve("stale");
      await settlePromiseHandlers();
    });

    // Either through a fresh initial render or the post-subscribe catch-up,
    // a second read must start instead of rendering the dropped promise
    // forever.
    for (let i = 0; i < 20 && loader.mock.calls.length < 2; i += 1) {
      await flushReact();
    }
    expect(loader).toHaveBeenCalledTimes(2);

    await resolveReload(second, "fresh");

    await waitForText(app.container, "fresh|background:0|transition:0|refresh:none");
  });

  it("catches up with invalidations missed during a suspended key switch", async () => {
    const lane = createLane();
    const staleB = deferred<string>();
    const freshB = deferred<string>();
    const bReads = [() => staleB.promise, () => freshB.promise];
    const loader = vi.fn((context: LaneLoaderContext) => {
      if (serializeKey(context.key) === serializeKey(["a"])) {
        return Promise.resolve("value-a");
      }

      const nextRead = bReads.shift();
      return nextRead ? nextRead() : Promise.resolve("unexpected-extra");
    });

    const app = await render(keyedApp(lane, ["a"], loader));
    await waitForText(app.container, "value-a|background:0|transition:0|refresh:none");

    // Switching keys re-reads during render and suspends; the subscription
    // effect for the new key cannot run until the read settles. React keeps
    // the previous content hidden in the DOM next to the fallback.
    await act(async () => {
      app.root.render(keyedApp(lane, ["b"], loader));
      await settlePromiseHandlers();
    });
    await waitForText(
      app.container,
      "value-a|background:0|transition:0|refresh:noneloading",
    );

    // The reader of ["b"] is not subscribed yet, so this invalidation drops
    // the entry without reaching anyone.
    await act(async () => {
      lane.invalidate(["b"]);
      await settlePromiseHandlers();
    });

    await act(async () => {
      staleB.resolve("stale-b");
      await settlePromiseHandlers();
    });

    // The dropped entry must force a second ["b"] read — either through a
    // re-read of the still-uncommitted render or through the post-subscribe
    // catch-up — instead of leaving the reader stuck on the dropped promise.
    for (let i = 0; i < 20 && bReads.length > 0; i += 1) {
      await flushReact();
    }
    expect(bReads).toHaveLength(0);

    await resolveReload(freshB, "fresh-b");

    await waitForText(app.container, "fresh-b|background:0|transition:0|refresh:none");
  });

  it("keeps showing previous data when a refetch rejects and exposes refreshError", async () => {
    const lane = createLane();
    const failing = deferred<string>();
    const recovering = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => failing.promise)
      .mockImplementationOnce(() => recovering.promise);

    lane.set(["tasks"], "cached");

    const app = await renderLaneApp({ lane, loader });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:none");

    await click(app.container, "invalidate");
    await waitForText(app.container, "cached|background:0|transition:1|refresh:none");

    await act(async () => {
      failing.reject(new Error("offline"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached|background:0|transition:0|refresh:offline");

    await click(app.container, "invalidate");
    await resolveReload(recovering, "recovered");

    await waitForText(app.container, "recovered|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("initial load rejections reach the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const lane = createLane();
    const loader = vi.fn(async () => {
      throw new Error("boom");
    });

    const app = await render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          CatchBoundary,
          null,
          React.createElement(
            React.Suspense,
            { fallback: "loading" },
            React.createElement(Probe, { loader }),
          ),
        ),
      }),
    );

    await waitForText(app.container, "caught:boom");
  });

  it("collects the cache after unmount once gcTime elapses", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 200 });
    const loader = vi.fn(async () => "loaded");

    const app = await renderLaneApp({ lane, loader });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const remounted = await renderLaneApp({ lane, loader });
    await waitForText(remounted.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("whenStale 'refetch' discards a stale value and refetches on remount", async () => {
    vi.useFakeTimers();

    // gcTime Infinity keeps the entry, so the remount refetch is a stale-reuse
    // decision, not garbage collection.
    const lane = createLane({ gcTime: Infinity });
    const loader = vi.fn(async () => "loaded");
    const options = {
      whenStale: "refetch" as const,
      staleTime: 100,
    };

    const app = await renderLaneApp({ lane, loader, options });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // past staleTime
    });

    const remounted = await renderLaneApp({ lane, loader, options });
    await waitForText(remounted.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("whenStale 'revalidate' (default) reuses a stale value on remount", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: Infinity });
    const loader = vi.fn(async () => "loaded");
    const options = { staleTime: 100 };

    const app = await renderLaneApp({ lane, loader, options });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // past staleTime
    });

    const remounted = await renderLaneApp({ lane, loader, options });
    await waitForText(remounted.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("gates the read by omitting the loader and loads once it is supplied", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "value");

    const app = await render(gatedApp(lane, false, loader));

    // Disabled: no loader, no subscription, and promise is undefined.
    await waitForText(app.container, "disabled");
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      app.root.render(gatedApp(lane, true, loader));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "value");
    expect(loader).toHaveBeenCalledTimes(1);

    // Flipping back off drops to undefined again without another fetch.
    await act(async () => {
      app.root.render(gatedApp(lane, false, loader));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "disabled");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe a disabled reader to store changes", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loader");

    const app = await render(gatedApp(lane, false, loader));
    await waitForText(app.container, "disabled");

    // A set on the same key must not wake a disabled reader.
    await act(async () => {
      lane.set(["tasks"], "published");
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "disabled");
    expect(loader).not.toHaveBeenCalled();
  });

  it("defers the initial read into a transition so the fallback never shows", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const loader = vi.fn(() => load.promise);

    const app = await render(deferredOnMountApp(lane, loader));

    // The loader is set unconditionally, so the fetch is already running while
    // the placeholder shows. The mount effect switches the reveal on *inside a
    // transition*, so the now-suspending `use()` does not reveal the Suspense
    // fallback: the committed placeholder stays on screen and isPending marks it.
    await waitForText(app.container, "placeholder|pending:1");
    expect(loader).toHaveBeenCalledTimes(1);

    // When the background read resolves the transition commits, swapping in the
    // value without the UI ever flashing "loading".
    await resolveReload(load, "value");
    await waitForText(app.container, "value|pending:0");
  });

  it("starts the fetch on mount even when the reveal never switches on", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const loader = vi.fn(() => load.promise);

    // flip: false — the reveal never switches on, so `use()` is never reached.
    // The unconditional loader still runs: the fetch is decoupled from the
    // reveal (owning the read vs. suspending on it are separate acts).
    const app = await render(deferredOnMountApp(lane, loader, false));

    await waitForText(app.container, "placeholder|pending:0");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reveals the fallback when the same gate flip skips the transition", async () => {
    // The contrast to the test above: flipping the gate *without* a transition
    // makes the suspending read a non-transition update, so React replaces the
    // committed placeholder with the Suspense fallback instead of keeping it.
    const lane = createLane();
    const load = deferred<string>();
    const loader = vi.fn(() => load.promise);

    const app = await render(eagerOnMountApp(lane, loader));

    // The fallback is on screen while the read is pending — not the placeholder.
    expect(app.container.textContent).toContain("loading");

    await resolveReload(load, "value");
    await waitForText(app.container, "value");
  });

  it("gated-loader defer also reveals through a transition without a fallback", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const loader = vi.fn(() => load.promise);

    const app = await render(gatedDeferOnMountApp(lane, loader));

    // Same deferred reveal as the inverted form: the committed placeholder is
    // held through the transition, the fallback never shows.
    await waitForText(app.container, "placeholder|pending:1");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(load, "value");
    await waitForText(app.container, "value|pending:0");
  });

  it("gated-loader defer does not fetch until the reveal switches on", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const loader = vi.fn(() => load.promise);

    // flip: false — the gated loader is never supplied, so nothing fetches. This
    // is the contrast with the inverted form, whose unconditional loader runs
    // regardless ("starts the fetch on mount even when the reveal never switches
    // on"): defer the reveal vs. defer the fetch itself.
    const app = await render(gatedDeferOnMountApp(lane, loader, false));

    await waitForText(app.container, "placeholder|pending:0");
    expect(loader).not.toHaveBeenCalled();
  });

  it("a mounted reader adopts a prefetched cache without refetching", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "warm");

    // Warm the cache imperatively (e.g. from a link's onMouseEnter), before any
    // reader mounts, and let it settle.
    lane.prefetch(["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    // Navigating mounts a reader of the same key: it adopts the warm cache and
    // renders the value without a second fetch.
    const app = await renderLaneApp({ lane, loader });
    await waitForText(app.container, "warm|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps the cache for remounts within gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 200 });
    const loader = vi.fn(async () => "loaded");

    const app = await renderLaneApp({ lane, loader });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const remounted = await renderLaneApp({ lane, loader });
    await waitForText(remounted.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

class CatchBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return React.createElement("div", null, `caught:${this.state.error.message}`);
    }

    return this.props.children;
  }
}

function Probe({
  cacheKey = ["tasks"],
  loader,
  options,
}: {
  cacheKey?: LaneKey;
  loader: LaneLoader<string>;
  options?: LaneUseOptions;
}) {
  const result = useLane(cacheKey, loader, options);
  const read = React.use(result.promise);
  const value = read.data;
  const refresh =
    read.refreshError === undefined
      ? "none"
      : read.refreshError instanceof Error
        ? read.refreshError.message
        : String(read.refreshError);

  return React.createElement(
    "button",
    {
      "data-testid": "invalidate",
      onClick: result.invalidate,
      type: "button",
    },
    `${value}|background:${flag(result.isBackgroundPending)}|transition:${flag(
      result.isTransitionPending,
    )}|refresh:${refresh}`,
  );
}

function GatedProbe({
  enabled,
  loader,
}: {
  enabled: boolean;
  loader: LaneLoader<string>;
}) {
  const result = useLane(["tasks"], enabled ? loader : undefined);
  // `use` may be called conditionally — the gated read is unwrapped only when
  // there is a promise, otherwise the reader renders its own fallback.
  const value = result.promise ? React.use(result.promise).data : "disabled";
  return React.createElement("div", null, value);
}

function gatedApp(
  lane: Lane,
  enabled: boolean,
  loader: LaneLoader<string>,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(GatedProbe, { enabled, loader }),
    ),
  });
}

// The "defer the reveal" technique: the loader is set unconditionally, so the
// fetch starts in render; only `use()` is gated. The first commit shows the
// placeholder without suspending (giving React "already revealed" content to
// keep), then the mount effect switches the reveal on inside a transition, which
// suspends without hiding it. With `flip: false` the reveal never switches on,
// so `use()` is never reached — yet the unconditional loader still runs.
function DeferredOnMountProbe({
  loader,
  flip = true,
}: {
  loader: LaneLoader<string>;
  flip?: boolean;
}) {
  const [reveal, setReveal] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (flip) {
      startTransition(() => {
        setReveal(true);
      });
    }
  }, [flip]);

  const { promise } = useLane(["tasks"], loader);
  const value = reveal ? React.use(promise).data : "placeholder";

  return React.createElement("div", null, `${value}|pending:${flag(isPending)}`);
}

function deferredOnMountApp(
  lane: Lane,
  loader: LaneLoader<string>,
  flip = true,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(DeferredOnMountProbe, { loader, flip }),
    ),
  });
}

// Same inverted shape as DeferredOnMountProbe, but the reveal flips WITHOUT a
// transition, so the now-suspending `use()` reveals the fallback instead of
// holding the placeholder.
function EagerOnMountProbe({ loader }: { loader: LaneLoader<string> }) {
  const [reveal, setReveal] = React.useState(false);

  React.useEffect(() => {
    setReveal(true);
  }, []);

  const { promise } = useLane(["tasks"], loader);
  const value = reveal ? React.use(promise).data : "placeholder";

  return React.createElement("div", null, value);
}

function eagerOnMountApp(
  lane: Lane,
  loader: LaneLoader<string>,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(EagerOnMountProbe, { loader }),
    ),
  });
}

// The gated-loader variant of the defer technique: the loader itself is gated
// off until the reveal switches on, so — unlike the unconditional
// DeferredOnMountProbe — nothing fetches until then. The reveal still flips
// inside a transition, so the suspend holds the placeholder rather than
// revealing the fallback. This is "Conditional reads + a transition"; the
// inverted form is "fetch now, defer only the reveal".
function GatedDeferOnMountProbe({
  loader,
  flip = true,
}: {
  loader: LaneLoader<string>;
  flip?: boolean;
}) {
  const [reveal, setReveal] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (flip) {
      startTransition(() => {
        setReveal(true);
      });
    }
  }, [flip]);

  const { promise } = useLane(["tasks"], reveal ? loader : undefined);
  const value = promise ? React.use(promise).data : "placeholder";

  return React.createElement("div", null, `${value}|pending:${flag(isPending)}`);
}

function gatedDeferOnMountApp(
  lane: Lane,
  loader: LaneLoader<string>,
  flip = true,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(GatedDeferOnMountProbe, { loader, flip }),
    ),
  });
}

function keyedApp(
  lane: Lane,
  cacheKey: LaneKey,
  loader: LaneLoader<string>,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(Probe, { cacheKey, loader }),
    ),
  });
}

function hydrationApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
  loader: LaneLoader<string>,
  options?: LaneUseOptions,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(LaneHydration, {
        snapshots,
        children: React.createElement(Probe, { loader, options }),
      }),
    ),
  });
}

async function renderLaneApp({
  lane,
  loader,
  options,
}: {
  lane: Lane;
  loader: LaneLoader<string>;
  options?: LaneUseOptions;
}): Promise<RenderedApp> {
  return render(
    React.createElement(
      LaneProvider,
      {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(Probe, { loader, options }),
        ),
      },
    ),
  );
}

async function render(element: React.ReactElement): Promise<RenderedApp> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  await act(async () => {
    root.render(element);
    await settlePromiseHandlers();
  });

  return { container, root };
}

function unmountApp(app: RenderedApp): void {
  const index = roots.indexOf(app.root);

  if (index >= 0) {
    roots.splice(index, 1);
  }

  act(() => {
    app.root.unmount();
  });
}

async function click(
  container: HTMLElement,
  testId: string,
): Promise<void> {
  const target = container.querySelector(`[data-testid="${testId}"]`);

  if (!(target instanceof HTMLElement)) {
    throw new Error(`Missing target: ${testId}`);
  }

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settlePromiseHandlers();
  });
}

async function resolveReload<T>(
  reload: ReturnType<typeof deferred<T>>,
  value: T,
): Promise<void> {
  await act(async () => {
    reload.resolve(value);
    await reload.promise;
    await settlePromiseHandlers();
  });
}

async function waitForText(
  container: HTMLElement,
  expected: string,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (container.textContent === expected) {
      return;
    }

    await flushReact();
  }

  expect(container.textContent).toBe(expected);
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await settlePromiseHandlers();
  });
}

function flag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
