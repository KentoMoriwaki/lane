// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane, useLanesAll } from "../index";
import type {
  Lane,
  LaneLoader,
  LaneReadSpec,
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

// The three revalidation triggers never reach the store — they are reader-side,
// resolved at fire time — so their fallback to `createLane({ defaults })` has to
// be exercised through a mounted reader rather than through `readOrCreate`.
describe("lane defaults through a reader", () => {
  it("refetches on mount from the defaults alone", async () => {
    const lane = createLane({
      defaults: { refetchOnMount: true, staleTime: 0 },
    });
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await render(readApp(lane, loader));

    // The seeded value stays on screen while the defaulted mount refetch runs.
    await waitForText(app.container, "cached");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "mounted");
    await waitForText(app.container, "mounted");
  });

  it("a read opts out of a defaulted trigger by writing `false`", async () => {
    const lane = createLane({
      defaults: { refetchOnMount: true, staleTime: 0 },
    });
    const loader = vi.fn(async () => "reloaded");

    lane.set(["tasks"], "cached");

    const app = await render(
      readApp(lane, loader, { refetchOnMount: false }),
    );

    await waitForText(app.container, "cached");
    expect(loader).not.toHaveBeenCalled();
  });

  it("judges a defaulted trigger against the defaulted staleTime", async () => {
    const lane = createLane({
      defaults: { refetchOnMount: true, staleTime: 60_000 },
    });
    const loader = vi.fn(async () => "reloaded");

    // `refetchOnMount: true` refreshes only stale entries, and the freshness it
    // is judged against comes from the same defaults — so a just-seeded value is
    // left alone.
    lane.set(["tasks"], "cached");

    const app = await render(readApp(lane, loader));

    await waitForText(app.container, "cached");
    expect(loader).not.toHaveBeenCalled();
  });

  it("refetches on focus from the defaults alone", async () => {
    const lane = createLane({
      defaults: { refetchOnFocus: true, staleTime: 0 },
    });
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);

    lane.set(["tasks"], "cached");

    const app = await render(readApp(lane, loader));
    await waitForText(app.container, "cached");
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "cached");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "focused");
    await waitForText(app.container, "focused");
  });

  it("reads a batch member against defaults > shared > its own", async () => {
    const lane = createLane({ defaults: { refetchOnMount: "always" } });
    const reloadA = deferred<string>();
    const reloadB = deferred<string>();
    const loaderA = vi.fn(() => reloadA.promise);
    const loaderB = vi.fn(() => reloadB.promise);

    lane.set(["a"], "A");
    lane.set(["b"], "B");

    // The batch turns the defaulted trigger off for every member; member B turns
    // it back on for itself. Three tiers, one render.
    const app = await render(
      batchApp(
        lane,
        [
          { key: ["a"], loader: loaderA },
          { key: ["b"], loader: loaderB, refetchOnMount: "always" },
        ],
        { refetchOnMount: false },
      ),
    );

    await waitForText(app.container, "A,B");
    expect(loaderA).not.toHaveBeenCalled();
    expect(loaderB).toHaveBeenCalledTimes(1);

    await resolveReload(reloadB, "B2");
    await waitForText(app.container, "A,B2");
  });

  it("reaches every batch member when only the defaults turn a trigger on", async () => {
    const lane = createLane({ defaults: { refetchOnMount: "always" } });
    const reloadA = deferred<string>();
    const reloadB = deferred<string>();
    const loaderA = vi.fn(() => reloadA.promise);
    const loaderB = vi.fn(() => reloadB.promise);

    lane.set(["a"], "A");
    lane.set(["b"], "B");

    const app = await render(
      batchApp(lane, [
        { key: ["a"], loader: loaderA },
        { key: ["b"], loader: loaderB },
      ]),
    );

    await waitForText(app.container, "A,B");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);

    await resolveReload(reloadA, "A2");
    await resolveReload(reloadB, "B2");
    await waitForText(app.container, "A2,B2");
  });
});

function ReadProbe({
  loader,
  options,
}: {
  loader: LaneLoader<string>;
  options?: LaneUseOptions;
}) {
  const { promise } = useLane({ ...options, key: ["tasks"], loader });
  return React.createElement(React.Fragment, null, React.use(promise).data);
}

function readApp(
  lane: Lane,
  loader: LaneLoader<string>,
  options?: LaneUseOptions,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(ReadProbe, { loader, options }),
    ),
  });
}

function BatchProbe({
  reads,
  options,
}: {
  reads: readonly LaneReadSpec<string>[];
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
  reads: readonly LaneReadSpec<string>[],
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
