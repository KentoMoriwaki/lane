// @vitest-environment jsdom

/**
 * `<Activity>` (stable in React 19.2) preserves a hidden subtree's state while
 * cleaning up its effects — both layout and passive, measured on 19.2. Lane's
 * subscription lives in a passive effect, so a hidden reader keeps its promise in
 * state with nothing subscribed to the store — the exact shape
 * `syncAfterSubscribe` exists for. These tests pin that the reveal converges
 * through the existing catch-up path, with no Activity-specific code.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane, LaneProvider, useLane } from "../index";
import type { Lane, LaneLoader } from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
} from "./test-utils";

type Mode = "hidden" | "visible";

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
  rerender: (mode: Mode) => Promise<void>;
};

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

function Probe({ loader }: { loader: LaneLoader<string> }) {
  const result = useLane({ key: ["tasks"], loader });
  const read = React.use(result.promise);

  return React.createElement(
    "div",
    { "data-testid": "value" },
    `${read.data}|background:${flag(result.isBackgroundPending)}|transition:${flag(
      result.isTransitionPending,
    )}`,
  );
}

function activityApp(
  lane: Lane,
  loader: LaneLoader<string>,
  mode: Mode,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement("span", null, "loading") },
        React.createElement(Probe, { loader }),
      ),
      mode,
    }),
  });
}

async function renderActivityApp({
  lane,
  loader,
  mode,
}: {
  lane: Lane;
  loader: LaneLoader<string>;
  mode: Mode;
}): Promise<RenderedApp> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  const rerender = async (nextMode: Mode) => {
    await act(async () => {
      root.render(activityApp(lane, loader, nextMode));
      await settlePromiseHandlers();
    });
  };

  await act(async () => {
    root.render(activityApp(lane, loader, mode));
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
