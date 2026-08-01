// @vitest-environment jsdom

/**
 * `<Activity>` (stable in React 19.2) preserves a hidden subtree's state while
 * cleaning up its effects — both layout and passive, measured on 19.2.
 *
 * Lane's subscription is a *passive* effect, so a hidden reader misses every
 * notification, and React re-shows the tree it committed before the hide
 * without re-rendering anything whose inputs did not change. What corrects the
 * first revealed frame is the layout reconciliation in `useLane`: layout
 * effects are re-created inside the reveal commit, before paint, and the
 * reconcile compares the committed promise against the store's current one —
 * the commit invariant that a reader only ever commits the store's current
 * promise. A replacement that settled while hidden (a value published behind
 * the reader's back) is adopted at the reveal without another loader call; a
 * repudiated or removed entry drops to the boundary's fallback with the
 * re-read starting at the reveal. The passive catch-up (`syncAfterSubscribe`)
 * still exists, but only for the microwindow between the last render and the
 * subscription — the reveal itself is the layout reconciliation's job.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane, LaneHydration, LaneProvider, useLane } from "../index";
import type {
  Lane,
  LaneHydrationSnapshots,
  LaneLoader,
  LaneReadSpec,
} from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
} from "./test-utils";

type Mode = "hidden" | "visible";

type ReadOptions = Omit<LaneReadSpec<string>, "key" | "loader">;

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
  rerender: (mode: Mode) => Promise<void>;
};

const roots: Root[] = [];

// The boundary's fallback increments this on every render. The republish test
// pins the structural guarantee — a reveal that carries a publication commits
// once, inside the revealing transition, without the fallback ever rendering —
// so the counter, not just the final value, is the assertion.
let fallbackRenders = 0;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }

  document.body.innerHTML = "";
  fallbackRenders = 0;
  resetVitest();
});

describe("Activity", () => {
  it("starts the read while the subtree is still hidden", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    // A hidden Activity pre-renders its children, so the read is created (and
    // the loader fires) before anything is on screen — prefetch on prerender,
    // with no prefetch call. Only the effects are withheld.
    const app = await renderActivityApp({ lane, loader, mode: "hidden" });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(valueElement(app).style.display).toBe("none");
    expect(app.container.textContent).toBe("loaded|background:0|transition:0");

    await app.rerender("visible");

    // The reveal adopts the entry the prerender warmed: the reconciliation
    // finds the committed promise still current, so no second request.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(valueElement(app).style.display).toBe("");
  });

  it("drops an invalidation missed while hidden to the fallback on reveal", async () => {
    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "hidden",
    });
    loads.resolveLast("v1");
    await flushReact();

    expect(loads.calls).toBe(1);

    // Effects — and so Lane's subscription — do not run in a hidden subtree, so
    // this notification reaches nobody. The entry stays invalidated.
    await act(async () => {
      lane.invalidate(["tasks"]);
      await settlePromiseHandlers();
    });

    expect(loads.calls).toBe(1);

    await app.rerender("visible");

    // The reveal reconciliation drops the repudiated promise inside the reveal
    // commit: the re-read starts at the reveal and the boundary shows its
    // fallback — the invalidated value is not offered as a new appearance.
    expect(loads.calls).toBe(2);
    expect(valueElement(app).style.display).toBe("none");
    expect(app.container.textContent).toContain("loading");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
    expect(valueElement(app).style.display).toBe("");
  });

  it("adopts a value published while hidden at the reveal", async () => {
    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
    });
    loads.resolveLast("v1");
    await flushReact();

    expect(app.container.textContent).toBe("v1|background:0|transition:0");

    await app.rerender("hidden");

    await act(async () => {
      lane.set(["tasks"], "v2");
      await settlePromiseHandlers();
    });

    expect(loads.calls).toBe(1);

    await app.rerender("visible");

    // The reconciliation adopts the published value at the reveal: no loader
    // call, and the superseded v1 is not what the reveal settles on. The
    // adoption suspends only until React has seen the already-resolved
    // promise, so the reveal resolves within the same flush.
    expect(app.container.textContent).toBe("v2|background:0|transition:0");
    expect(valueElement(app).style.display).toBe("");
    expect(loads.calls).toBe(1);
  });

  it("re-reads at the reveal after a removal missed while hidden", async () => {
    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
    });
    loads.resolveLast("v1");
    await flushReact();

    await app.rerender("hidden");

    await act(async () => {
      lane.remove(["tasks"]);
      await settlePromiseHandlers();
    });

    expect(loads.calls).toBe(1);

    await app.rerender("visible");

    // The entry is gone, so the reconciliation's read-through re-creates it at
    // the reveal: fallback first, never the removed value.
    expect(loads.calls).toBe(2);
    expect(valueElement(app).style.display).toBe("none");
    expect(app.container.textContent).toContain("loading");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it('discards a stale value on reveal under whenStale: "refetch"', async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
      options: { staleTime: 10, whenStale: "refetch" },
    });
    loads.resolveLast("v1");
    await flushReact();

    await app.rerender("hidden");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(loads.calls).toBe(1);

    await app.rerender("visible");

    // The reveal runs before the reader re-subscribes, so to `reuseCache` it
    // is a genuine idle remount: the stale-and-adopted value is discarded and
    // the reveal suspends on a fresh read — staleness promoted to a drop only
    // because the read opted in.
    expect(loads.calls).toBe(2);
    expect(valueElement(app).style.display).toBe("none");
    expect(app.container.textContent).toContain("loading");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it("leaves a merely stale value in place on reveal by default", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
      options: { staleTime: 10 },
    });
    loads.resolveLast("v1");
    await flushReact();

    await app.rerender("hidden");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await app.rerender("visible");

    // Staleness is suspicion, not repudiation: the default `whenStale`
    // ("revalidate") reuses the cache, the reconciliation sees the committed
    // promise still current, and the reveal shows the value as-is.
    expect(loads.calls).toBe(1);
    expect(app.container.textContent).toBe("v1|background:0|transition:0");
    expect(valueElement(app).style.display).toBe("");
  });

  it("reveals a republish that landed while hidden with no fallback", async () => {
    vi.useFakeTimers();

    // Infinity keeps the GC sweep out of runOnlyPendingTimers: the hide
    // unsubscribes the reader, which arms the lane-wide sweep, and running
    // pending timers would otherwise evict the entry mid-scenario.
    const lane = createLane({ gcTime: Infinity });
    const loads = controllableLoader();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-2" }],
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.append(container);
    roots.push(root);

    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "visible", first));
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });
    await waitForText(container, "server-1|background:0|transition:0");
    expect(loads.calls).toBe(0);

    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "hidden", first));
      await settlePromiseHandlers();
    });

    // The payload arrives while the tree is still hidden: the offscreen render
    // picks up the new snapshots, the publish lands, and the hidden reader —
    // unsubscribed, so no notification could reach it — adopts the seed
    // through the source switch in its own (offscreen) render.
    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "hidden", second));
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    const fallbacksBeforeReveal = fallbackRenders;

    // The framework resolved the data before revealing; Lane must not convert
    // that into a loading state. The reveal shows the republished value in its
    // first committed frame — no fallback, no loader.
    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "visible", second));
      await settlePromiseHandlers();
    });

    await waitForText(container, "server-2|background:0|transition:0");
    expect(valueElement({ container } as RenderedApp).style.display).toBe("");
    expect(loads.calls).toBe(0);
    expect(fallbackRenders).toBe(fallbacksBeforeReveal);
  });

  it("carries an outer republish through a stable inner boundary", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: Infinity });
    const loads = controllableLoader();
    const outerFirst: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-1" }],
    };
    const outerSecond: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-2" }],
    };
    // One instance across every render: the inner boundary publishes nothing
    // new, so the nearest-boundary value alone would never change for the
    // reader below it. The lineage is what carries the outer republish past it.
    const inner: LaneHydrationSnapshots = {
      entries: [{ key: ["other"], data: "inner" }],
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.append(container);
    roots.push(root);

    const renderApp = (mode: Mode, outer: LaneHydrationSnapshots) =>
      root.render(
        React.createElement(LaneProvider, {
          lane,
          children: React.createElement(React.Activity, {
            children: React.createElement(
              React.Suspense,
              { fallback: React.createElement(Fallback) },
              React.createElement(LaneHydration, {
                children: React.createElement(LaneHydration, {
                  children: React.createElement(Probe, {
                    loader: loads.loader,
                  }),
                  snapshots: inner,
                }),
                snapshots: outer,
              }),
            ),
            mode,
          }),
        }),
      );

    await act(async () => {
      renderApp("visible", outerFirst);
      await settlePromiseHandlers();
    });
    // Nested boundaries publish sequentially: the inner one first renders —
    // and schedules its publish — once the outer's has landed, so the mount
    // needs one timer flush per depth.
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });
    await waitForText(container, "server-1|background:0|transition:0");
    expect(loads.calls).toBe(0);

    await act(async () => {
      renderApp("hidden", outerFirst);
      await settlePromiseHandlers();
    });

    await act(async () => {
      renderApp("hidden", outerSecond);
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    const fallbacksBeforeReveal = fallbackRenders;

    await act(async () => {
      renderApp("visible", outerSecond);
      await settlePromiseHandlers();
    });

    await waitForText(container, "server-2|background:0|transition:0");
    expect(loads.calls).toBe(0);
    expect(fallbackRenders).toBe(fallbacksBeforeReveal);
  });

  it("suspends the reveal into the fallback while its publish is in flight", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: Infinity });
    const loads = controllableLoader();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: "server-2" }],
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.append(container);
    roots.push(root);

    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "visible", first));
      await settlePromiseHandlers();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });
    await waitForText(container, "server-1|background:0|transition:0");

    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "hidden", first));
      await settlePromiseHandlers();
    });

    // Characterization, not a Lane guarantee: a reveal that outruns its
    // publish suspends on the hydration boundary, and previously-hidden
    // content is not held by a transition the way visible content is — the
    // boundary falls back until the publish lands. This mirrors what Next
    // itself does on such revisits (the reveal is instant, in-flight holes
    // show their fallbacks), so Lane is not adding a loading state the
    // framework would have avoided.
    await act(async () => {
      root.render(hydrationActivityApp(lane, loads.loader, "visible", second));
      await settlePromiseHandlers();
    });

    expect(container.textContent).toContain("loading");

    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    await waitForText(container, "server-2|background:0|transition:0");
    expect(loads.calls).toBe(0);
  });

  it("releases the store subscription while hidden", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    const app = await renderActivityApp({ lane, loader, mode: "visible" });
    await waitForText(app.container, "loaded|background:0|transition:0");
    expect(loader).toHaveBeenCalledTimes(1);

    await app.rerender("hidden");

    // Hiding cleans the reader's effects up, so it is no longer a subscriber and
    // no longer anchors the entry against the lane-wide sweep. The sweep skips
    // any entry that still has one (see core-gc), so collection here *is* the
    // observation that the subscription was released.
    subscribe(lane, ["__churn__"])();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await readOrCreate(lane, ["tasks"], loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

// A loader whose every call is resolved by hand, so a read can be observed while
// it is still in flight.
function controllableLoader() {
  const pending: ReturnType<typeof deferred<string>>[] = [];
  const loader = vi.fn(() => {
    const next = deferred<string>();
    pending.push(next);

    return next.promise;
  });

  return {
    get calls() {
      return loader.mock.calls.length;
    },
    loader: loader as LaneLoader<string>,
    resolveLast(value: string) {
      pending.at(-1)?.resolve(value);
    },
  };
}

function Probe({
  loader,
  options,
}: {
  loader: LaneLoader<string>;
  options?: ReadOptions;
}) {
  const result = useLane({ key: ["tasks"], loader, ...options });
  const read = React.use(result.promise);

  return React.createElement(
    "div",
    { "data-testid": "value" },
    `${read.data}|background:${flag(result.isBackgroundPending)}|transition:${flag(
      result.isTransitionPending,
    )}`,
  );
}

function Fallback() {
  fallbackRenders += 1;

  return React.createElement("span", null, "loading");
}

function activityApp(
  lane: Lane,
  loader: LaneLoader<string>,
  mode: Mode,
  options?: ReadOptions,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(Probe, { loader, options }),
      ),
      mode,
    }),
  });
}

function hydrationActivityApp(
  lane: Lane,
  loader: LaneLoader<string>,
  mode: Mode,
  snapshots: LaneHydrationSnapshots,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(LaneHydration, {
          children: React.createElement(Probe, { loader }),
          snapshots,
        }),
      ),
      mode,
    }),
  });
}

async function renderActivityApp({
  lane,
  loader,
  mode,
  options,
}: {
  lane: Lane;
  loader: LaneLoader<string>;
  mode: Mode;
  options?: ReadOptions;
}): Promise<RenderedApp> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  const rerender = async (nextMode: Mode) => {
    await act(async () => {
      root.render(activityApp(lane, loader, nextMode, options));
      await settlePromiseHandlers();
    });
  };

  await act(async () => {
    root.render(activityApp(lane, loader, mode, options));
    await settlePromiseHandlers();
  });

  return { container, rerender, root };
}

function valueElement(app: RenderedApp): HTMLElement {
  const element = app.container.querySelector('[data-testid="value"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("Missing the probe's value element");
  }

  return element;
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
