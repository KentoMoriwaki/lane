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
 * Wider in a way that decides *where* the convergence has to happen. A hidden
 * reader holds a committed value for as long as it stays hidden, so an
 * invalidation and a removal part ways on the way back exactly as they do for a
 * subscribed one: the first keeps that value on screen while the re-read runs,
 * the second must not, because a removal says the value no longer belongs in
 * client state at all. And "must not" is stricter than any effect can deliver —
 * passive effects run after the commit is already on screen, so a removal
 * converged there is a frame of removed data. What makes the strict version
 * possible is that a reveal *renders*: React re-renders the subtree it reveals
 * (19.2, including a `memo` whose props did not move), so the reader can drop the
 * value during that render and the reveal's own commit is already the fallback.
 * The last test here is the one that can tell those two apart.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import {
  createLane,
  LaneHydration,
  LaneProvider,
  useLane,
  useLanesAll,
} from "../index";
import type {
  Lane,
  LaneHydrationSnapshots,
  LaneLoader,
  LaneUseOptions,
} from "../types";
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
  // The reveal on its own: rendered, committed and read back before the
  // scheduler runs anything else, so what it returns is the frame the browser
  // would paint. `act` cannot express that — it runs the commit and the passive
  // effects that follow it as one step.
  revealSynchronously: () => void;
};

const EMPTY_OPTIONS: LaneUseOptions = {};

const roots: Root[] = [];

beforeAll(() => {
  setActEnvironment(true);
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
    expect(valueElement(app.container).style.display).toBe("none");
    expect(app.container.textContent).toBe("loaded|background:0|transition:0");

    await app.rerender("visible");

    // The reveal adopts the entry the prerender warmed: no second request.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(valueElement(app.container).style.display).toBe("");
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

    // Missed the same way the invalidation above was, and deliberately not
    // converged the same way: a removal says the value no longer belongs in
    // client state, so it is dropped on the way back rather than held on screen
    // while the re-read runs. This is the sign-out case — the list is gone from
    // the lane, and the user must not go on watching their own for as long as the
    // next request takes.
    await act(async () => {
      lane.remove(["tasks"]);
      await settlePromiseHandlers();
    });

    await app.rerender("visible");

    expect(loads.calls).toBe(2);
    expect(app.container.textContent).toContain("loading");
    expect(valueElement(app.container).style.display).toBe("none");

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
    expect(valueElement(app.container).style.display).toBe("none");

    loads.resolveLast("v2");
    await flushReact();

    expect(app.container.textContent).toBe("v2|background:0|transition:0");
  });

  it("does not paint the removed value in the commit that reveals", async () => {
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

    // The test above reveals through `act`, which runs the commit and the passive
    // effects that follow it as one step — so it cannot tell a reader that never
    // showed the removed value from one that showed it and then took it back a
    // frame later. This reveal is committed on its own, and read before the
    // scheduler runs anything else: the frame the browser would paint.
    app.revealSynchronously();

    expect(app.container.textContent).toContain("loading");
    expect(valueElement(app.container).style.display).toBe("none");
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

  it("takes a re-hydration that landed while it was hidden", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "client");
    const hydrated = await renderHydrationApp({ lane, loader, mode: "visible" });

    await waitForText(hydrated.container, "server-v1|background:0|transition:0");

    await hydrated.rerender(FIRST_SNAPSHOTS, "hidden");

    // New server data for a subtree that is hidden, so unsubscribed: the
    // notification `hydrateMany` fans out reaches nobody here. The reader takes
    // it anyway — `LaneHydration` hands what it published to the readers under
    // it, and a context value is a render-time input, so it arrives while the
    // subtree is still hidden rather than one commit after it comes back.
    await hydrated.rerender(SECOND_SNAPSHOTS, "hidden");

    const value = valueElement(hydrated.container);
    expect(value.style.display).toBe("none");
    expect(value.textContent).toBe("server-v2|background:0|transition:0");

    await hydrated.rerender(SECOND_SNAPSHOTS, "visible");

    expect(hydrated.container.textContent).toBe(
      "server-v2|background:0|transition:0",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("takes one an outer boundary published when hydration nests", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "client");
    // The reader's key is seeded by the *outer* boundary; the inner one seeds
    // something else entirely. Boundaries nest — a layout seeds some keys and a
    // page seeds others — and a reader is under all of them at once, so what the
    // inner one hands down has to carry the outer one's seeding with it.
    const hydrated = await renderHydrationApp({
      inner: { entries: [{ data: "unrelated", key: ["other"] }] },
      lane,
      loader,
      mode: "visible",
    });

    await waitForText(hydrated.container, "server-v1|background:0|transition:0");

    await hydrated.rerender(FIRST_SNAPSHOTS, "hidden", {
      entries: [{ data: "unrelated", key: ["other"] }],
    });
    await hydrated.rerender(SECOND_SNAPSHOTS, "hidden", {
      entries: [{ data: "unrelated-2", key: ["other"] }],
    });

    expect(valueElement(hydrated.container).textContent).toBe(
      "server-v2|background:0|transition:0",
    );
    expect(loader).not.toHaveBeenCalled();
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

function setActEnvironment(value: boolean): void {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = value;
}

const FIRST_SNAPSHOTS: LaneHydrationSnapshots = {
  entries: [{ data: "server-v1", key: ["tasks"] }],
};

const SECOND_SNAPSHOTS: LaneHydrationSnapshots = {
  entries: [{ data: "server-v2", key: ["tasks"] }],
};

// The same `<Activity>` shape seeded from server snapshots, optionally through a
// second `LaneHydration` nested inside the first.
function hydrationApp(
  lane: Lane,
  loader: LaneLoader<string>,
  mode: Mode,
  snapshots: LaneHydrationSnapshots,
  inner: LaneHydrationSnapshots | undefined,
): React.ReactElement {
  const probe = React.createElement(React.Activity, {
    children: React.createElement(
      React.Suspense,
      { fallback: React.createElement("span", null, "loading") },
      React.createElement(Probe, { loader, options: EMPTY_OPTIONS }),
    ),
    mode,
  });

  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: React.createElement("span", null, "hydrating") },
      React.createElement(LaneHydration, {
        children: inner
          ? React.createElement(LaneHydration, {
              children: probe,
              snapshots: inner,
            })
          : probe,
        snapshots,
      }),
    ),
  });
}

async function renderHydrationApp({
  inner,
  lane,
  loader,
  mode,
}: {
  inner?: LaneHydrationSnapshots;
  lane: Lane;
  loader: LaneLoader<string>;
  mode: Mode;
}): Promise<{
  container: HTMLDivElement;
  rerender: (
    snapshots: LaneHydrationSnapshots,
    nextMode: Mode,
    nextInner?: LaneHydrationSnapshots,
  ) => Promise<void>;
}> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  // Hydration publishes from a macrotask, and a nested boundary only starts its
  // own once the one above it has resolved — so waiting for a fixed number of
  // them races. The boundary's fallback is the signal that one is still in
  // flight.
  const settleHydration = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      if (!container.textContent?.includes("hydrating")) {
        return;
      }
    }

    throw new Error("Hydration never settled");
  };

  const rerender = async (
    snapshots: LaneHydrationSnapshots,
    nextMode: Mode,
    nextInner?: LaneHydrationSnapshots,
  ) => {
    await act(async () => {
      root.render(hydrationApp(lane, loader, nextMode, snapshots, nextInner));
      await settlePromiseHandlers();
    });
    await settleHydration();
  };

  await rerender(FIRST_SNAPSHOTS, mode, inner);

  return { container, rerender };
}

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

  const revealSynchronously = () => {
    setActEnvironment(false);
    flushSync(() => {
      root.render(activityApp(lane, "visible", probe, props));
    });
    setActEnvironment(true);
  };

  await act(async () => {
    root.render(activityApp(lane, mode, probe, props));
    await settlePromiseHandlers();
  });

  return { container, rerender, revealSynchronously, root };
}

function valueElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="value"]');

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
