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
import type {
  Lane,
  LaneHydrationSnapshots,
  LaneKey,
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

    await waitForText(app.container, "cached|background:0|transition:0");

    await click(app.container, "invalidate");

    await waitForText(app.container, "cached|background:0|transition:1");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "reloaded");

    await waitForText(app.container, "reloaded|background:0|transition:0");
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

    await waitForText(app.container, "cached|background:0|transition:0");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached|background:1|transition:0");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "focused");

    await waitForText(app.container, "focused|background:0|transition:0");
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

    await waitForText(app.container, "cached|background:1|transition:0");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "mounted");

    await waitForText(app.container, "mounted|background:0|transition:0");
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
      React.createElement(
        LaneProvider,
        {
          lane,
          children: React.createElement(
            React.Suspense,
            { fallback: "loading" },
            React.createElement(LaneHydration, {
              snapshots,
              children: React.createElement(Probe, {
                loader,
                options: {
                  refetchOnMount: true,
                  staleTime: 1_000,
                },
              }),
            }),
          ),
        },
      ),
    );

    await waitForText(app.container, "loading");

    await act(async () => {
      vi.runOnlyPendingTimers();
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "server|background:0|transition:0");
    expect(loader).not.toHaveBeenCalled();
  });
});

function Probe({
  cacheKey = ["tasks"],
  loader,
  options,
}: {
  cacheKey?: LaneKey;
  loader: () => Promise<string>;
  options?: LaneUseOptions;
}) {
  const result = useLane(cacheKey, loader, options);
  const value = React.use(result.promise);

  return React.createElement(
    "button",
    {
      "data-testid": "invalidate",
      onClick: result.invalidate,
      type: "button",
    },
    `${value}|background:${flag(result.isBackgroundPending)}|transition:${flag(
      result.isTransitionPending,
    )}`,
  );
}

async function renderLaneApp({
  lane,
  loader,
  options,
}: {
  lane: Lane;
  loader: () => Promise<string>;
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
