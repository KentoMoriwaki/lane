// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLane,
  infiniteLaneRead,
  laneRead,
  LaneProvider,
  useInfiniteLane,
  useLane,
  useLanesAll,
} from "../index";
import type { LaneProviderProps } from "../provider";
import type { Lane, LaneGatedReadSpec, LaneReadSpec } from "../types";
import type { InfiniteLaneReadSpec } from "../use-infinite-lane";
import { resetVitest, settlePromiseHandlers } from "./test-utils";

/**
 * The lane's `loaderMeta` — the dependency a loader needs that is not part of its
 * key, supplied to the provider rather than bound into the read.
 *
 * These tests cover the wiring and the **undeclared** branch of `LaneRegister`,
 * which is what this package compiles against: with nothing declared, `meta` is
 * typed `undefined` and the provider prop is absent, so supplying a value here
 * needs the cast in `providerProps` below. The *declared* branch — `meta` typed
 * and non-optional, the prop and `prefetch` argument required — cannot be proven
 * from inside this program, because a `declare module` augmentation applies to the
 * whole program and would require every other test to supply one. It is proven by
 * `apps/demo`, which declares it for real and is covered by `pnpm typecheck`.
 */
type Ctx = { userId: string; teamId: string };

const CTX: Ctx = { teamId: "team-1", userId: "u1" };
const OTHER_CTX: Ctx = { teamId: "team-2", userId: "u1" };

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

describe("loaderMeta", () => {
  it("reaches the loader as `meta`", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const read = laneRead({
      key: ["task", "t1"],
      loader: async ({ meta }) => {
        seen.push(meta);
        return "loaded";
      },
    });

    const app = await render(probeApp(lane, read, CTX));

    await waitForText(app.container, "loaded");
    expect(seen).toEqual([CTX]);
  });

  it("is `undefined` when the provider supplies none", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const read = laneRead({
      key: ["task", "t1"],
      loader: async ({ meta }) => {
        seen.push(meta);
        return "loaded";
      },
    });

    const app = await render(probeApp(lane, read, undefined));

    await waitForText(app.container, "loaded");
    expect(seen).toEqual([undefined]);
  });

  it("is not part of the key: a changed meta names the same entry", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const read = laneRead({ key: ["task", "t1"], loader });

    const app = await render(probeApp(lane, read, CTX));
    await waitForText(app.container, "loaded");
    expect(loader).toHaveBeenCalledTimes(1);

    // Re-rendering with a different meta must not read a different entry — the
    // cached promise for this key is reused, and nothing refetches.
    await act(async () => {
      app.root.render(probeApp(lane, read, OTHER_CTX));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("hands the latest meta to a re-read after invalidation", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const read = laneRead({
      key: ["task", "t1"],
      loader: async ({ meta }) => {
        seen.push(meta);
        return `loaded-${seen.length}`;
      },
    });

    const app = await render(probeApp(lane, read, CTX));
    await waitForText(app.container, "loaded-1");

    await act(async () => {
      app.root.render(probeApp(lane, read, OTHER_CTX));
      await settlePromiseHandlers();
    });

    await act(async () => {
      lane.invalidate(read.key);
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "loaded-2");
    expect(seen).toEqual([CTX, OTHER_CTX]);
  });

  it("is snapshotted with the read, so every retry sees the same value", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => {
        throw new Error("boom");
      })
      .mockImplementationOnce(async () => "recovered");
    const read = laneRead({
      key: ["task", "t1"],
      loader: ({ meta }) => {
        seen.push(meta);
        return loader();
      },
      retry: 1,
      retryDelay: () => 0,
    });

    await lane.prefetch(read, { loaderMeta: CTX } as never);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([CTX, CTX]);
  });

  it("reaches every member of a batch read", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const reads = [
      laneRead({
        key: ["a"],
        loader: async ({ meta }) => {
          seen.push(meta);
          return "A";
        },
      }),
      laneRead({
        key: ["b"],
        loader: async ({ meta }) => {
          seen.push(meta);
          return "B";
        },
      }),
    ];

    const app = await render(batchApp(lane, reads, CTX));

    await waitForText(app.container, "A,B");
    expect(seen).toEqual([CTX, CTX]);
  });

  it("reaches an infinite read on both the refresh and loadMore paths", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const spec = infiniteLaneRead({
      key: ["feed"],
      initialCursor: 0,
      fetchPage: async (cursor: number, { meta }) => {
        seen.push(meta);
        return { items: [`item-${cursor}`], next: cursor < 2 ? cursor + 1 : null };
      },
      nextCursor: (page) => page.next,
    });

    const app = await render(infiniteApp(lane, spec, CTX));
    await waitForStatus(app.container, "item-0");
    expect(seen).toEqual([CTX]);

    // `loadMore` appends through `lane.update`, which is not a read — so this is
    // the path that would silently lose the meta if it were only threaded
    // through the read options.
    await click(app.container, "more");
    await waitForStatus(app.container, "item-0,item-1");
    expect(seen).toEqual([CTX, CTX]);
  });

  it("takes the prefetch argument for a read outside React", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const read = laneRead({
      key: ["task", "t1"],
      loader: async ({ meta }) => {
        seen.push(meta);
        return "warmed";
      },
    });

    await lane.prefetch(read, { loaderMeta: CTX } as never);

    expect(seen).toEqual([CTX]);
  });
});

/**
 * `LaneProvider`'s props with a `loaderMeta` this program cannot type: nothing is
 * declared here, so the prop is `loaderMeta?: undefined`. The cast is confined to
 * this helper — see the note at the top of the file.
 */
function providerProps(
  lane: Lane,
  loaderMeta: Ctx | undefined,
  children: React.ReactNode,
): LaneProviderProps {
  return { children, lane, loaderMeta } as unknown as LaneProviderProps;
}

function Probe({ spec }: { spec: LaneGatedReadSpec<string> }): React.ReactNode {
  const { promise } = useLane(spec);
  return promise ? React.use(promise).data : "disabled";
}

function BatchProbe({
  reads,
}: {
  reads: readonly LaneReadSpec<string>[];
}): React.ReactNode {
  const values = React.use(useLanesAll(reads));
  return values.map((read) => read.data).join(",");
}

type Page = { items: string[]; next: number | null };

function InfiniteProbe({
  spec,
}: {
  spec: InfiniteLaneReadSpec<Page, number>;
}): React.ReactNode {
  const { promise, loadMore } = useInfiniteLane(spec);
  const { data } = React.use(promise);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "output",
      null,
      data.pages.flatMap((page) => page.items).join(","),
    ),
    React.createElement(
      "button",
      { onClick: () => loadMore(), type: "button" },
      "more",
    ),
  );
}

function suspended(child: React.ReactElement): React.ReactElement {
  return React.createElement(React.Suspense, { fallback: "loading" }, child);
}

function probeApp(
  lane: Lane,
  spec: LaneGatedReadSpec<string>,
  loaderMeta: Ctx | undefined,
): React.ReactElement {
  return React.createElement(
    LaneProvider,
    providerProps(lane, loaderMeta, suspended(React.createElement(Probe, { spec }))),
  );
}

function batchApp(
  lane: Lane,
  reads: readonly LaneReadSpec<string>[],
  loaderMeta: Ctx | undefined,
): React.ReactElement {
  return React.createElement(
    LaneProvider,
    providerProps(
      lane,
      loaderMeta,
      suspended(React.createElement(BatchProbe, { reads })),
    ),
  );
}

function infiniteApp(
  lane: Lane,
  spec: InfiniteLaneReadSpec<Page, number>,
  loaderMeta: Ctx | undefined,
): React.ReactElement {
  return React.createElement(
    LaneProvider,
    providerProps(
      lane,
      loaderMeta,
      suspended(React.createElement(InfiniteProbe, { spec })),
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

async function click(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settlePromiseHandlers();
  });
}

async function waitForText(
  container: HTMLElement,
  expected: string,
): Promise<void> {
  await waitFor(() => container.textContent, expected);
}

async function waitForStatus(
  container: HTMLElement,
  expected: string,
): Promise<void> {
  await waitFor(() => container.querySelector("output")?.textContent, expected);
}

async function waitFor(
  read: () => string | null | undefined,
  expected: string,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (read() === expected) {
      return;
    }

    await act(async () => {
      await settlePromiseHandlers();
    });
  }

  expect(read()).toBe(expected);
}
