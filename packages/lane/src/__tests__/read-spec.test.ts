// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createLane,
  infiniteLaneRead,
  laneRead,
  LaneProvider,
  useInfiniteLane,
  useLane,
  useLanePromise,
  useLanesAll,
} from "../index";
import type {
  Lane,
  LaneGatedReadSpec,
  LaneGatedResult,
  LaneLoader,
  LaneRead,
  LaneReadSpec,
  LaneResult,
  LaneUseOptions,
} from "../types";
import type {
  InfiniteLaneReadSpec,
  InfiniteLaneValue,
} from "../use-infinite-lane";
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

describe("laneRead", () => {
  it("hands back the spec it was given", () => {
    const spec = { key: ["task", "t1"], loader: async () => "T1" };

    expect(laneRead(spec)).toBe(spec);
  });

  it("reads through the spec's own key and loader", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    lane.set(["task", "t1"], "seeded");

    const app = await render(
      probeApp(lane, laneRead({ key: ["task", "t1"], loader })),
    );

    // The seeded entry is reused, which is only true if the spec's key is the
    // key the read used.
    await waitForText(app.container, "seeded");
    expect(loader).not.toHaveBeenCalled();
  });

  it("reads with the options the spec carries", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);
    lane.set(["task", "t1"], "seeded");

    const app = await render(
      probeApp(
        lane,
        // The freshness policy travels with the definition — no call site has to
        // remember to pass it.
        laneRead({ key: ["task", "t1"], loader, refetchOnMount: "always" }),
      ),
    );

    await waitForText(app.container, "seeded");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "refetched");
    await waitForText(app.container, "refetched");
  });

  it("gates the read when the spec's loader is absent", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const app = await render(
      probeApp(lane, laneRead<string>({ key: ["task", "t1"], loader: undefined })),
    );

    await waitForText(app.container, "disabled");
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      app.root.render(probeApp(lane, laneRead({ key: ["task", "t1"], loader })));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reads through useLanePromise", async () => {
    const lane = createLane();
    const spec = laneRead({
      key: ["task", "t1"],
      loader: async () => "loaded",
    });

    const app = await render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(PromiseProbe, { spec }),
        ),
      }),
    );

    await waitForText(app.container, "loaded");
  });
});

describe("a spec as a Lane target", () => {
  it("invalidates the read it describes", async () => {
    const lane = createLane();
    const spec = laneRead({ key: ["task", "t1"], loader: async () => "loaded" });
    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "loaded");

    await act(async () => {
      lane.set(["task", "t1"], "published");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "published");

    await act(async () => {
      lane.invalidate(spec);
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "loaded");
  });

  it("publishes and updates through the spec", async () => {
    const lane = createLane();
    const spec = laneRead({ key: ["task", "t1"], loader: async () => "loaded" });
    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "loaded");

    await act(async () => {
      lane.set(spec, "published");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "published");

    await act(async () => {
      lane.update(spec, (current) => `${current}+patched`);
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "published+patched");
  });

  it("removes the entry the spec names", async () => {
    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => "first")
      .mockImplementationOnce(async () => "second");
    const spec = laneRead({ key: ["task", "t1"], loader });

    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "first");

    await act(async () => {
      lane.remove(spec);
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("cancels the in-flight read the spec names", async () => {
    const lane = createLane();
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    const spec = laneRead({
      key: ["task", "t1"],
      loader: (context) => {
        signal = context.signal;
        return pending.promise;
      },
    });

    lane.prefetch(spec);
    // The loader starts on a microtask, so the signal only exists after one.
    await settlePromiseHandlers();
    expect(signal?.aborted).toBe(false);

    lane.cancel(spec);

    expect(signal?.aborted).toBe(true);
  });
});

describe("prefetching a spec", () => {
  it("is adopted by a later read of the same spec", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "warmed");
    const spec = laneRead({ key: ["task", "t1"], loader });

    await lane.prefetch(spec);
    expect(loader).toHaveBeenCalledTimes(1);

    const app = await render(probeApp(lane, spec));

    await waitForText(app.container, "warmed");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("takes the spec's retry policy but not its freshness policy", async () => {
    const lane = createLane();
    const loader = vi
      .fn<LaneLoader<string>>()
      .mockImplementationOnce(async () => {
        throw new Error("boom");
      })
      .mockImplementationOnce(async () => "recovered");
    const spec = laneRead({
      key: ["task", "t1"],
      loader,
      retry: 1,
      retryDelay: () => 0,
      // A read-time decision; prefetch pins "revalidate" so the second call
      // below dedupes onto the warm cache instead of discarding it.
      whenStale: "refetch",
    });

    const warmed = await lane.prefetch(spec);
    expect(warmed.data).toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);

    await lane.prefetch(spec);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("useLanesAll with specs", () => {
  it("reads every member", async () => {
    const lane = createLane();
    const reads = [
      laneRead({ key: ["a"], loader: async () => "A" }),
      laneRead({ key: ["b"], loader: async () => "B" }),
    ];

    const app = await render(batchApp(lane, reads));

    await waitForText(app.container, "A,B");
  });

  it("gives each member its own options", async () => {
    const lane = createLane();
    const reloadA = deferred<string>();
    const loaderA = vi.fn(() => reloadA.promise);
    const loaderB = vi.fn(async () => "B");
    lane.set(["a"], "A");
    lane.set(["b"], "B");

    const app = await render(
      batchApp(lane, [
        laneRead({ key: ["a"], loader: loaderA, refetchOnMount: "always" }),
        laneRead({ key: ["b"], loader: loaderB }),
      ]),
    );

    await waitForText(app.container, "A,B");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).not.toHaveBeenCalled();

    await resolveReload(reloadA, "A2");
    await waitForText(app.container, "A2,B");
  });

  it("falls back to the batch's shared options", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);
    lane.set(["a"], "A");

    const app = await render(
      batchApp(lane, [laneRead({ key: ["a"], loader })], {
        refetchOnMount: "always",
      }),
    );

    await waitForText(app.container, "A");
    expect(loader).toHaveBeenCalledTimes(1);

    await resolveReload(reload, "A2");
    await waitForText(app.container, "A2");
  });

  it("revalidates on focus per member, by that member's own option", async () => {
    const lane = createLane();
    const reload = deferred<string>();
    const loaderA = vi.fn(() => reload.promise);
    const loaderB = vi.fn(async () => "B");
    lane.set(["a"], "A");
    lane.set(["b"], "B");

    const app = await render(
      batchApp(lane, [
        laneRead({ key: ["a"], loader: loaderA, refetchOnFocus: true }),
        laneRead({ key: ["b"], loader: loaderB }),
      ]),
    );
    await waitForText(app.container, "A,B");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "A,B");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).not.toHaveBeenCalled();

    await resolveReload(reload, "A2");
    await waitForText(app.container, "A2,B");
  });

  it("lets a member's own options win over the shared ones", async () => {
    const lane = createLane();
    const loaderA = vi.fn(async () => "A");
    const loaderB = vi.fn(async () => "B");
    lane.set(["a"], "A");
    lane.set(["b"], "B");

    const app = await render(
      batchApp(
        lane,
        [
          laneRead({ key: ["a"], loader: loaderA, refetchOnMount: false }),
          laneRead({ key: ["b"], loader: loaderB }),
        ],
        { refetchOnMount: "always" },
      ),
    );

    await waitForText(app.container, "A,B");
    expect(loaderA).not.toHaveBeenCalled();
    expect(loaderB).toHaveBeenCalledTimes(1);
  });
});

describe("infiniteLaneRead", () => {
  it("reads and extends the list the spec describes", async () => {
    const lane = createLane();
    const spec = infiniteLaneRead({
      key: ["feed"],
      initialCursor: 0,
      fetchPage: async (cursor: number) => ({
        items: [`item-${cursor}`],
        next: cursor < 2 ? cursor + 1 : null,
      }),
      nextCursor: (page) => page.next,
    });

    const app = await render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(InfiniteProbe, { spec }),
        ),
      }),
    );

    await waitForStatus(app.container, "item-0|more:yes");

    await click(app.container, "more");
    await waitForStatus(app.container, "item-0,item-1|more:yes");

    // The key travels with the definition, so the same spec addresses the entry
    // — and the re-read walks the chain as deep as the list already is.
    await act(async () => {
      lane.invalidate(spec);
      await settlePromiseHandlers();
    });
    await waitForStatus(app.container, "item-0,item-1|more:yes");
  });
});

/**
 * Type-level expectations. Never called — `pnpm typecheck` (which covers
 * `src/__tests__`) is what enforces them, so a regression in inference is a
 * build failure rather than a silently `unknown`-typed read.
 */
function typeExpectations(lane: Lane): void {
  type Task = { id: string; title: string };
  const task: Task = { id: "t1", title: "Write" };

  const detail = laneRead({
    key: ["task", task.id],
    loader: async () => task,
    staleTime: 60_000,
  });

  // `T` comes from the loader's return type, at the definition.
  expectTypeOf(detail).toEqualTypeOf<LaneReadSpec<Task, Task>>();

  // A definite loader keeps `promise` definite; a gated one does not.
  expectTypeOf(useLane(detail)).toEqualTypeOf<LaneResult<Task>>();
  expectTypeOf(useLanePromise(detail)).toEqualTypeOf<Promise<LaneRead<Task>>>();

  // Overriding one option at a call site is a spread, and stays typed.
  expectTypeOf(useLane({ ...detail, refetchOnFocus: true })).toEqualTypeOf<
    LaneResult<Task>
  >();

  const gated = laneRead({
    key: ["task", task.id],
    loader: task.id ? async () => task : undefined,
  });
  expectTypeOf(gated).toEqualTypeOf<LaneGatedReadSpec<Task, Task>>();
  expectTypeOf(useLane(gated)).toEqualTypeOf<LaneGatedResult<Task>>();

  // `C` still defaults to `T`, and is still the way to type `current`.
  const accumulating = laneRead<Task[], string>({
    key: ["tasks"],
    loader: async ({ current }) => {
      expectTypeOf(current).toEqualTypeOf<string | undefined>();
      return [task];
    },
  });
  expectTypeOf(accumulating).toEqualTypeOf<LaneReadSpec<Task[], string>>();

  // Writes are checked against the read's type — the payoff of fixing `T` at
  // the definition instead of at the call site.
  lane.set(detail, task);
  lane.update(detail, (current) => {
    expectTypeOf(current).toEqualTypeOf<Task>();
    return { ...current, title: "Edited" };
  });
  // @ts-expect-error — not what this read loads.
  lane.set(detail, "not a task");
  // @ts-expect-error — same check on the updater's result.
  lane.update(detail, () => "not a task");

  // A key stays a key everywhere a spec is accepted.
  lane.invalidate(["task", task.id]);
  lane.invalidate(detail);
  lane.remove(detail);
  lane.cancel(detail);
  expectTypeOf(lane.prefetch(detail)).toEqualTypeOf<Promise<LaneRead<Task>>>();
  // @ts-expect-error — prefetch needs something to load.
  lane.prefetch(gated);

  expectTypeOf(useLanesAll([detail, detail])).toEqualTypeOf<
    Promise<LaneRead<Task>[]>
  >();

  const feed = infiniteLaneRead({
    key: ["feed"],
    initialCursor: 0,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
  });
  expectTypeOf(useInfiniteLane(feed).promise).toEqualTypeOf<
    Promise<LaneRead<InfiniteLaneValue<{ rows: Task[]; next: number }, number>>>
  >();
}

void typeExpectations;

function Probe({
  spec,
}: {
  spec: LaneGatedReadSpec<string>;
}): React.ReactNode {
  const { promise } = useLane(spec);
  return promise ? React.use(promise).data : "disabled";
}

function PromiseProbe({ spec }: { spec: LaneReadSpec<string> }): React.ReactNode {
  return React.use(useLanePromise(spec)).data;
}

function BatchProbe({
  reads,
  options,
}: {
  reads: readonly LaneReadSpec<string>[];
  options?: LaneUseOptions;
}): React.ReactNode {
  const values = React.use(useLanesAll(reads, options));
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
    // The status goes in its own element so the button's label stays out of the
    // text being asserted on.
    React.createElement(
      "output",
      null,
      `${data.pages.flatMap((page) => page.items).join(",")}|more:${
        data.hasNext ? "yes" : "no"
      }`,
    ),
    React.createElement(
      "button",
      { onClick: () => loadMore(), type: "button" },
      "more",
    ),
  );
}

function probeApp(
  lane: Lane,
  spec: LaneGatedReadSpec<string>,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(Probe, { spec }),
    ),
  });
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
