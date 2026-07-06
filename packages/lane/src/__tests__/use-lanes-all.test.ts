// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLanesAll } from "../index";
import type { Lane, LaneKey, LaneLoader, LaneUseOptions } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

type Reads = readonly (readonly [LaneKey, LaneLoader<string>])[];

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
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

describe("useLanesAll", () => {
  it("resolves every read's data", async () => {
    const lane = createLane();
    lane.set(["a"], "A");
    lane.set(["b"], "B");
    const loaderA = vi.fn(async () => "A");
    const loaderB = vi.fn(async () => "B");

    const app = await render(
      batchApp(lane, [
        [["a"], loaderA],
        [["b"], loaderB],
      ]),
    );

    await waitForText(app.container, "A,B");
    // Seeded values are reused; loaders are never called.
    expect(loaderA).not.toHaveBeenCalled();
    expect(loaderB).not.toHaveBeenCalled();
  });

  it("stays suspended until every read resolves", async () => {
    const lane = createLane();
    const a = deferred<string>();
    const b = deferred<string>();

    const app = await render(
      batchApp(lane, [
        [["a"], () => a.promise],
        [["b"], () => b.promise],
      ]),
    );

    await waitForText(app.container, "loading");

    await act(async () => {
      a.resolve("A");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "loading"); // still waiting on the slowest

    await act(async () => {
      b.resolve("B");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A,B");
  });

  it("adds a read without refetching the existing ones", async () => {
    const lane = createLane();
    const loaderA = vi.fn(async () => "A");
    const loaderB = vi.fn(async () => "B");

    const app = await render(batchApp(lane, [[["a"], loaderA]]));
    await waitForText(app.container, "A");
    expect(loaderA).toHaveBeenCalledTimes(1);

    await act(async () => {
      app.root.render(
        batchApp(lane, [
          [["a"], loaderA],
          [["b"], loaderB],
        ]),
      );
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "A,B");
    expect(loaderA).toHaveBeenCalledTimes(1); // reused, not refetched
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it("removing a read stops it from waking the batch", async () => {
    const lane = createLane();
    const loaderA = vi.fn(async () => "A");
    const loaderB = vi.fn(async () => "B");

    const app = await render(
      batchApp(lane, [
        [["a"], loaderA],
        [["b"], loaderB],
      ]),
    );
    await waitForText(app.container, "A,B");

    await act(async () => {
      app.root.render(batchApp(lane, [[["a"], loaderA]]));
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A");

    // The dropped ["b"] reader must no longer converge the batch.
    await act(async () => {
      lane.set(["b"], "B2");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A");
  });

  it("updates one read through a transition without a fallback flash", async () => {
    const lane = createLane();
    lane.set(["a"], "A");
    lane.set(["b"], "B");
    const reload = deferred<string>();
    const loaderA = vi.fn(() => reload.promise);
    const loaderB = vi.fn(async () => "B");

    const app = await render(
      batchApp(lane, [
        [["a"], loaderA],
        [["b"], loaderB],
      ]),
    );
    await waitForText(app.container, "A,B");

    await act(async () => {
      lane.invalidate(["a"]);
      await settlePromiseHandlers();
    });
    // Held on the previous values (no "loading" flash) while ["a"] reloads.
    await waitForText(app.container, "A,B");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).not.toHaveBeenCalled();

    await resolveReload(reload, "A2");
    await waitForText(app.container, "A2,B");
  });

  it("throws an initial-load failure to the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const lane = createLane();
    const reads: Reads = [
      [
        ["a"],
        async () => {
          throw new Error("boom");
        },
      ],
      [["b"], async () => "B"],
    ];

    const app = await render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          CatchBoundary,
          null,
          React.createElement(
            React.Suspense,
            { fallback: "loading" },
            React.createElement(BatchProbe, { reads }),
          ),
        ),
      }),
    );

    await waitForText(app.container, "caught:boom");
  });

  it("holds the previous values while a member refetches in the background", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loaderA = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => "A1")
      .mockImplementationOnce(() => reload.promise);

    const app = await render(batchApp(lane, [[["a"], loaderA]]));
    await waitForText(app.container, "A1");
    expect(loaderA).toHaveBeenCalledTimes(1);

    // A background refresh — what a self-scheduled poll calls now that
    // `refetchInterval` is gone. The previous value stays on screen (no fallback).
    await act(async () => {
      lane.invalidate(["a"], { background: true, onlyIf: "settled" });
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A1");
    expect(loaderA).toHaveBeenCalledTimes(2);

    await resolveReload(reload, "A2");
    await waitForText(app.container, "A2");
  });

  it("re-subscribes on a mid-flight shared option change", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loaderA = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => "A1")
      .mockImplementationOnce(() => reload.promise);

    // Mount with focus refetch off.
    const app = await render(batchApp(lane, [[["a"], loaderA]]));
    await waitForText(app.container, "A1");
    expect(loaderA).toHaveBeenCalledTimes(1);

    // Turn `refetchOnFocus` on: the batch re-subscribes with the new option.
    await act(async () => {
      app.root.render(
        batchApp(lane, [[["a"], loaderA]], { refetchOnFocus: true }),
      );
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A1");

    // Focus now refetches — it would not have before the re-subscribe.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "A1");
    expect(loaderA).toHaveBeenCalledTimes(2);

    await resolveReload(reload, "A2");
    await waitForText(app.container, "A2");
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
      return React.createElement(
        "div",
        null,
        `caught:${this.state.error.message}`,
      );
    }

    return this.props.children;
  }
}

function BatchProbe({
  reads,
  options,
}: {
  reads: Reads;
  options?: LaneUseOptions;
}) {
  const values = React.use(useLanesAll(reads, options));
  return React.createElement(
    React.Fragment,
    null,
    values.map((read) => read.data).join(","),
  );
}

function batchApp(
  lane: Lane,
  reads: Reads,
  options?: LaneUseOptions,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(BatchProbe, { options, reads }),
    ),
  });
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
