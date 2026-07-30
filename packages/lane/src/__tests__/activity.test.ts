// @vitest-environment jsdom

/**
 * `<Activity>` (stable in React 19.2) preserves a hidden subtree's state while
 * cleaning up its effects — both layout and passive, measured on 19.2.
 *
 * Lane's subscription is a *passive* effect, and passive effects are scheduled
 * rather than run in the commit: hiding tears down layout effects in the hide's
 * commit and the passive ones a tick later, and revealing mounts them a tick
 * after the subtree is already on screen. So the subscribed window never lines up
 * exactly with the visible one in either direction — a hidden reader stays
 * subscribed briefly, and a revealed one renders before it re-subscribes.
 *
 * That is the same render-then-subscribe gap `syncAfterSubscribe` already exists
 * for (see `use-lane.ts`), just wider. These tests pin that the reveal converges
 * through that catch-up path, with no Activity-specific code.
 *
 * Wider in one way that matters to what the catch-up does rather than whether it
 * runs: a hidden reader holds a committed value for as long as it stays hidden,
 * so an invalidation and a removal have to part ways there exactly as they do for
 * a subscribed one. The first keeps that value on screen while the re-read runs;
 * the second must not, because a removal says the value no longer belongs in
 * client state at all.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane, LaneProvider, useLane, useLanesAll } from "../index";
import type { Lane, LaneLoader, LaneUseOptions } from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
} from "./test-utils";

type Mode = "hidden" | "visible";

type ProbeProps = { loader: LaneLoader<string>; options: LaneUseOptions };

type ProbeComponent = (props: ProbeProps) => React.ReactNode;

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
  rerender: (mode: Mode) => Promise<void>;
};

const EMPTY_OPTIONS: LaneUseOptions = {};

const roots: Root[] = [];

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

    // The reveal adopts the entry the prerender warmed: no second request.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(valueElement(app).style.display).toBe("");
  });

  it("catches up on the reveal with an invalidation missed while hidden", async () => {
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

    // Subscribing on the reveal runs the catch-up, which converges through the
    // background transition: the previous value stays on screen while the
    // re-read runs, rather than the reveal flashing a fallback.
    expect(loads.calls).toBe(2);
    expect(app.container.textContent).toBe("v1|background:1|transition:0");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it("reveals behind the fallback when the key was removed while hidden", async () => {
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

    // Same missed notification as the invalidation above, and deliberately not
    // the same catch-up: a removal says the value no longer belongs in client
    // state, so converging through a transition — which keeps the last committed
    // render on screen while the re-read runs — would reveal the subtree still
    // showing the removed data. This is the sign-out case: the list is gone from
    // the lane, and the user must not go on watching their own for as long as the
    // next request takes.
    await act(async () => {
      lane.remove(["tasks"]);
      await settlePromiseHandlers();
    });

    await app.rerender("visible");

    expect(loads.calls).toBe(2);
    expect(app.container.textContent).toContain("loading");
    expect(valueElement(app).style.display).toBe("none");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it("reveals a batch behind the fallback when a member was removed while hidden", async () => {
    const lane = createLane();
    const loads = controllableLoader();

    const app = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
      probe: BatchProbe,
    });
    loads.resolveLast("v1");
    await flushReact();
    await app.rerender("hidden");

    await act(async () => {
      lane.remove(["tasks"]);
      await settlePromiseHandlers();
    });

    await app.rerender("visible");

    expect(loads.calls).toBe(2);
    expect(app.container.textContent).toContain("loading");
    expect(valueElement(app).style.display).toBe("none");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it("re-reads on a reveal only where a trigger asks for it", async () => {
    const lane = createLane();
    const loads = controllableLoader();

    // A reveal restores the effects, not the render: `<Activity>` keeps the
    // subtree's state precisely so nothing re-runs, and the reader holds the
    // promise it committed on. So the reveal is not a read, and `whenStale`
    // — which decides what a *read* does with a stale value — has nothing to
    // decide. Only the catch-up runs, and it reuses what the key holds.
    const stale = await renderActivityApp({
      lane,
      loader: loads.loader,
      mode: "visible",
      options: { staleTime: 0, whenStale: "refetch" },
    });
    loads.resolveLast("v1");
    await flushReact();
    expect(loads.calls).toBe(1);

    await stale.rerender("hidden");
    await stale.rerender("visible");

    expect(loads.calls).toBe(1);
    expect(stale.container.textContent).toBe("v1|background:0|transition:0");

    // `refetchOnMount` is the trigger that does fire, because a reveal re-runs
    // effects — which is how an app asks for "refresh when this comes back".
    const refreshes = controllableLoader();
    const remount = await renderActivityApp({
      lane: createLane(),
      loader: refreshes.loader,
      mode: "visible",
      options: { refetchOnMount: "always" },
    });
    // Two, before the subtree is ever hidden: a suspended mount commits only
    // once its read settles, so the trigger fires on the real mount with a
    // settled value to refresh. Settle that refresh too, or the reveal's trigger
    // finds a read in flight and `"always"` skips it (`onlyIf: "settled"`).
    refreshes.resolveLast("mounted");
    await flushReact();
    refreshes.resolveLast("mounted");
    await flushReact();

    expect(refreshes.calls).toBe(2);

    await remount.rerender("hidden");
    await remount.rerender("visible");

    expect(refreshes.calls).toBe(3);
    // In the background, so the reveal shows the value it already had rather
    // than dropping to a fallback.
    expect(remount.container.textContent).toBe("mounted|background:1|transition:0");
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

function Probe({ loader, options }: ProbeProps) {
  const result = useLane({ ...options, key: ["tasks"], loader });
  const read = React.use(result.promise);

  return React.createElement(
    "div",
    { "data-testid": "value" },
    `${read.data}|background:${flag(result.isBackgroundPending)}|transition:${flag(
      result.isTransitionPending,
    )}`,
  );
}

// The same read through `useLanesAll`, which subscribes its members from an
// effect exactly as `useLane` does — and so loses them to a hidden subtree in
// exactly the same way. It renders the shape `Probe` does, minus the flags a
// batch does not expose, so both read against the same expected text.
function BatchProbe({ loader, options }: ProbeProps) {
  const reads = React.useMemo(() => [{ key: ["tasks"], loader }], [loader]);
  const [read] = React.use(useLanesAll(reads, options));

  if (!read) {
    throw new Error("Missing the batch's only member");
  }

  return React.createElement(
    "div",
    { "data-testid": "value" },
    `${read.data}|background:0|transition:0`,
  );
}

function activityApp(
  lane: Lane,
  mode: Mode,
  probe: ProbeComponent,
  props: ProbeProps,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement("span", null, "loading") },
        React.createElement(probe, props),
      ),
      mode,
    }),
  });
}

async function renderActivityApp({
  lane,
  loader,
  mode,
  options = EMPTY_OPTIONS,
  probe = Probe,
}: {
  lane: Lane;
  loader: LaneLoader<string>;
  mode: Mode;
  options?: LaneUseOptions;
  probe?: ProbeComponent;
}): Promise<RenderedApp> {
  const container = document.createElement("div");
  const root = createRoot(container);
  const props: ProbeProps = { loader, options };

  document.body.append(container);
  roots.push(root);

  const rerender = async (nextMode: Mode) => {
    await act(async () => {
      root.render(activityApp(lane, nextMode, probe, props));
      await settlePromiseHandlers();
    });
  };

  await act(async () => {
    root.render(activityApp(lane, mode, probe, props));
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
