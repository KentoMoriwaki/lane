// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createLane,
  external,
  infiniteLaneRead,
  infiniteLaneSnapshot,
  laneKey,
  laneRead,
  laneSnapshot,
  LaneProvider,
  useInfiniteLane,
  useLane,
  useLanePromise,
  useLanesAll,
} from "../index";
import type {
  Lane,
  LaneGatedReadSpec,
  LaneSnapshot,
  LaneGatedResult,
  LaneKeyOf,
  LaneLoader,
  LaneRead,
  LaneReadSpec,
  LaneResult,
  LaneUseOptions,
} from "../types";
import type {
  InfiniteLaneExternalReadSpec,
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
        laneRead({
          key: ["task", "t1"],
          loader,
          refetchOnMount: true,
          staleTime: 0,
        }),
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

describe("the key a spec carries", () => {
  it("invalidates the entry it names", async () => {
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
      lane.invalidate(spec.key);
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "loaded");
  });

  it("publishes and updates through the key", async () => {
    const lane = createLane();
    const spec = laneRead({ key: ["task", "t1"], loader: async () => "loaded" });
    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "loaded");

    await act(async () => {
      lane.set(spec.key, "published");
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "published");

    await act(async () => {
      lane.update(spec.key, (current) => `${current}+patched`);
      await settlePromiseHandlers();
    });
    await waitForText(app.container, "published+patched");
  });

  it("removes the entry it names", async () => {
    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => "first")
      .mockImplementationOnce(async () => "second");
    const spec = laneRead({ key: ["task", "t1"], loader });

    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "first");

    await act(async () => {
      lane.remove(spec.key);
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("cancels the in-flight read it names", async () => {
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

    lane.cancel(spec.key);

    expect(signal?.aborted).toBe(true);
  });
});

describe("laneKey", () => {
  it("hands back the key it was given", () => {
    const key = ["task", "t1"];

    expect(laneKey<string>(key)).toBe(key);
  });

  it("names the same entry a read of that key does", async () => {
    const lane = createLane();
    // The write side declares the key on its own — no loader, no fetcher, none
    // of the context a fetcher would need.
    const taskKeys = { detail: (id: string) => laneKey<string>(["task", id]) };
    const spec = laneRead({
      key: taskKeys.detail("t1"),
      loader: async () => "loaded",
    });

    const app = await render(probeApp(lane, spec));
    await waitForText(app.container, "loaded");

    await act(async () => {
      lane.set(taskKeys.detail("t1"), "published");
      await settlePromiseHandlers();
    });

    // Tagging is type-level only: the reader converged, so both forms resolved
    // to one entry.
    await waitForText(app.container, "published");
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

  it("does not take the spec's reader-side policy", async () => {
    const lane = createLane();
    const loader = vi.fn<LaneLoader<string>>().mockResolvedValue("warmed");
    const spec = laneRead({
      key: ["task", "t1"],
      loader,
      // Both describe a reader — when one refreshes, and how long a value
      // outlives one. A prefetch is not a reader, so the second call below
      // dedupes onto the warm cache rather than re-warming it.
      staleTime: 0,
      gcTime: 0,
    });

    const warmed = await lane.prefetch(spec);
    expect(warmed.data).toBe("warmed");
    expect(loader).toHaveBeenCalledTimes(1);

    await lane.prefetch(spec);
    expect(loader).toHaveBeenCalledTimes(1);
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
        laneRead({
          key: ["a"],
          loader: loaderA,
          refetchOnMount: true,
          staleTime: 0,
        }),
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
        refetchOnMount: true,
        staleTime: 0,
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
        // `staleTime: 0` is what makes `true` fire at all: the default is
        // Infinity, so a value is never stale and the trigger has nothing to do.
        laneRead({
          key: ["a"],
          loader: loaderA,
          refetchOnFocus: true,
          staleTime: 0,
        }),
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
        { refetchOnMount: true, staleTime: 0 },
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

    // The key travels with the definition, so it addresses the entry on its own
    // — and the re-read is the list as it starts, one page.
    await act(async () => {
      lane.invalidate(spec.key);
      await settlePromiseHandlers();
    });
    await waitForStatus(app.container, "item-0|more:yes");
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

  // `T` comes from the loader's return type, at the definition — and the key it
  // hands back carries that type.
  expectTypeOf(detail).toExtend<LaneReadSpec<Task, Task>>();
  expectTypeOf(detail.key).toEqualTypeOf<LaneKeyOf<Task>>();

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
  expectTypeOf(gated).toExtend<LaneGatedReadSpec<Task, Task>>();
  expectTypeOf(useLane(gated)).toEqualTypeOf<LaneGatedResult<Task>>();
  // Gating does not change what the entry would hold, so the key is tagged too.
  expectTypeOf(gated.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // `C` still defaults to `T`, and is still the way to type `current`.
  const accumulating = laneRead<Task[], string>({
    key: ["tasks"],
    loader: async ({ current }) => {
      expectTypeOf(current).toEqualTypeOf<string | undefined>();
      return [task];
    },
  });
  expectTypeOf(accumulating).toExtend<LaneReadSpec<Task[], string>>();
  // The tag is what the entry holds (`T`), never what `current` is (`C`).
  expectTypeOf(accumulating.key).toEqualTypeOf<LaneKeyOf<Task[]>>();

  // Writes through a tagged key are checked against what that key holds — no
  // loader involved, and no type argument at the call site.
  expectTypeOf(lane.set(detail.key, task)).toEqualTypeOf<
    Promise<LaneRead<Task>>
  >();
  lane.update(detail.key, (current) => {
    expectTypeOf(current).toEqualTypeOf<Task>();
    return { ...current, title: "Edited" };
  });
  // @ts-expect-error — not what this key holds.
  lane.set(detail.key, "not a task");
  // @ts-expect-error — same check on the updater's result.
  lane.update(detail.key, () => "not a task");
  // @ts-expect-error — and on what the updater is handed.
  lane.update(detail.key, (current: string) => current);

  // A key factory can carry the types on its own — no loader, no request
  // context, which is the point of tagging the key rather than the read.
  const taskKeys = { detail: (id: string) => laneKey<Task>(["task", id]) };
  expectTypeOf(taskKeys.detail(task.id)).toEqualTypeOf<LaneKeyOf<Task>>();
  expectTypeOf(lane.set(taskKeys.detail(task.id), task)).toEqualTypeOf<
    Promise<LaneRead<Task>>
  >();
  // @ts-expect-error — the key says Task.
  lane.set(taskKeys.detail(task.id), { title: "no id" });

  // A read can be built on an already-typed key; what it hands back is tagged
  // from its own loader either way.
  const fromTypedKey = laneRead({
    key: taskKeys.detail(task.id),
    loader: async () => task,
  });
  expectTypeOf(fromTypedKey.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // A plain key carries no type, so the value still decides it, exactly as
  // before tagging existed.
  expectTypeOf(lane.set(["task", task.id], task)).toEqualTypeOf<
    Promise<LaneRead<Task>>
  >();
  expectTypeOf(
    lane.update<Task>(["task", task.id], (current) => current),
  ).toEqualTypeOf<Promise<LaneRead<Task>> | undefined>();

  // Entry operations that carry no value take either kind of key.
  lane.invalidate(["task", task.id]);
  lane.invalidate(detail.key);
  lane.remove(detail.key);
  lane.cancel(detail.key);
  lane.invalidateAll(["task"]);

  // `prefetch` is the one method that takes the whole read: it performs one.
  expectTypeOf(lane.prefetch(detail)).toEqualTypeOf<Promise<LaneRead<Task>>>();
  expectTypeOf(
    lane.prefetch({ key: ["task", task.id], loader: async () => task }),
  ).toEqualTypeOf<Promise<LaneRead<Task>>>();
  // @ts-expect-error — prefetch needs something to load.
  lane.prefetch(gated);
  // @ts-expect-error — and a key is not a read.
  lane.prefetch(["task", task.id]);

  expectTypeOf(useLanesAll([detail, detail])).toEqualTypeOf<
    Promise<LaneRead<Task>[]>
  >();

  const feed = infiniteLaneRead({
    key: ["feed"],
    initialCursor: 0,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
  });
  type FeedPage = { rows: Task[]; next: number };
  expectTypeOf(useInfiniteLane(feed).promise).toEqualTypeOf<
    Promise<LaneRead<InfiniteLaneValue<FeedPage, number>>>
  >();
  // An infinite key holds the accumulated list, so that is what it is tagged
  // with — a write through it is checked against the whole value, not one page.
  expectTypeOf(feed.key).toEqualTypeOf<
    LaneKeyOf<InfiniteLaneValue<FeedPage, number>>
  >();

  // The list whose first page the route publishes: no `initialCursor` (the
  // published value carries the cursor page 1 was fetched with), and the same
  // `loadMore` halves as any other list.
  const routeFeed = infiniteLaneRead({
    key: ["feed", "route"],
    loader: external,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
  });

  expectTypeOf(routeFeed).toExtend<
    InfiniteLaneExternalReadSpec<FeedPage, number>
  >();
  expectTypeOf(routeFeed.key).toEqualTypeOf<
    LaneKeyOf<InfiniteLaneValue<FeedPage, number>>
  >();
  expectTypeOf(useInfiniteLane(routeFeed).promise).toEqualTypeOf<
    Promise<LaneRead<InfiniteLaneValue<FeedPage, number>>>
  >();

  // Freshness is the owner's on this form exactly as on `laneRead`'s external
  // one — and the pagination halves `loadMore` needs stay required.
  infiniteLaneRead({
    key: ["feed", "route"],
    loader: external,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
    // @ts-expect-error — nothing local re-reads this key.
    staleTime: 30_000,
  });
  infiniteLaneRead({
    key: ["feed", "route"],
    loader: external,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
    // @ts-expect-error — same for every revalidation trigger.
    refetchOnMount: true,
  });
  infiniteLaneRead({
    key: ["feed", "route"],
    loader: external,
    // @ts-expect-error — `loadMore` is still the client's, so it is required.
    nextCursor: (page: FeedPage) => page.next,
  });

  // The seed is the accumulated value, built from one page — checked against
  // what the key holds, like every other snapshot.
  expectTypeOf(
    infiniteLaneSnapshot(routeFeed, { rows: [task], next: 1 }, 0),
  ).toEqualTypeOf<LaneSnapshot<InfiniteLaneValue<FeedPage, number>>>();
  // @ts-expect-error — a page is not the list the key holds.
  laneSnapshot(routeFeed, { rows: [task], next: 1 });
  // @ts-expect-error — and the cursor is the one `fetchPage` takes.
  infiniteLaneSnapshot(routeFeed, { rows: [task], next: 1 }, "0");
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
