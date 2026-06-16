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

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const app = await renderLaneApp({
      lane,
      loader,
      options: { gcTime: 200 },
    });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(1);

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const remounted = await renderLaneApp({
      lane,
      loader,
      options: { gcTime: 200 },
    });
    await waitForText(remounted.container, "loaded|background:0|transition:0|refresh:none");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("gates the read with enabled and loads once it flips on", async () => {
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

  it("keeps the cache for remounts within gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const app = await renderLaneApp({
      lane,
      loader,
      options: { gcTime: 200 },
    });
    await waitForText(app.container, "loaded|background:0|transition:0|refresh:none");

    unmountApp(app);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const remounted = await renderLaneApp({
      lane,
      loader,
      options: { gcTime: 200 },
    });
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
  options?: Omit<LaneUseOptions, "enabled">;
}) {
  const result = useLane(cacheKey, loader, options);
  const value = React.use(result.promise);
  const refresh =
    result.refreshError === undefined
      ? "none"
      : result.refreshError instanceof Error
        ? result.refreshError.message
        : String(result.refreshError);

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
  const result = useLane(["tasks"], loader, { enabled });
  // `use` may be called conditionally — the gated read is unwrapped only when
  // there is a promise, otherwise the reader renders its own fallback.
  const value = result.promise ? React.use(result.promise) : "disabled";
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
