// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLane,
  external,
  infiniteLaneRead,
  infiniteLaneSnapshot,
  LaneHydration,
  LaneProvider,
  useInfiniteLane,
} from "../index";
import { publishedBy } from "../hydrate";
import type { InfiniteLaneResult } from "../use-infinite-lane";
import type {
  Lane,
  LaneHydrationSnapshots,
  LaneUseOptions,
} from "../types";
import {
  caughtMessage,
  deferred,
  resetVitest,
  settlePromiseHandlers,
} from "./test-utils";

// A page is just its cursor plus the cursor after it, so a rendered list reads
// as the cursors it was assembled from.
type Page = { index: number; next: number | null };

type Handle = InfiniteLaneResult<Page, number>;

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
};

const roots: Root[] = [];

/**
 * The probe publishes its handle so a test can call `loadMore` / `invalidate`
 * the way a click handler would — published from an *effect*, so it is the
 * handle of the last **committed** render.
 *
 * That distinction matters for `isInvalidationPending`: inside the transition's
 * own render (the future tree, which suspends and never commits here) the flag
 * is already `false`, because that render is what the screen looks like once the
 * transition is done. The pending screen is the committed one.
 */
let handle: Handle | null = null;

type Mode = "hidden" | "visible";

/**
 * Where the route-published feed's `loadMore` fetches from. The read is one
 * module-level value (a route publishes against one definition), so the pages
 * behind it are what a test swaps.
 */
let pageSource: PageFetcher | undefined;

/** Every committed frame of the route-published reader, consecutive dupes dropped. */
const frames: string[] = [];

let fallbackRenders = 0;

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

  handle = null;
  pageSource = undefined;
  frames.length = 0;
  fallbackRenders = 0;
  document.body.innerHTML = "";
  resetVitest();
});

describe("useInfiniteLane", () => {
  it("loads one page on mount", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));

    await waitForText(app.container, "0|more");
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([0]);
  });

  it("appends exactly one page per loadMore", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([0, 1, 2]);
  });

  it("serializes two loadMore calls instead of fetching one page twice", async () => {
    // Two calls in one tick — a double click, or a scroll sentinel that fires
    // again before the first append lands. The second `update` chains onto the
    // cache the first one installed, so its updater does not run until the first
    // page has arrived and therefore reads the *appended* value: it continues the
    // list rather than re-fetching the page the first call is already loading.
    const lane = createLane();
    const gated = gatedFetcher(10);

    const app = await render(feedApp(lane, gated.fetchPage));
    await gated.resolveNext();
    await waitForText(app.container, "0|more");

    await click(() => {
      handle?.loadMore();
      handle?.loadMore();
    });

    // Only the first append is in flight; the second is still waiting on it.
    expect(gated.pending()).toEqual([1]);

    await gated.resolveNext();
    expect(gated.pending()).toEqual([2]);

    await gated.resolveNext();
    await waitForText(app.container, "0,1,2|more");
    expect(gated.fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      0, 1, 2,
    ]);
  });

  it("re-reads every loaded page, one after the other, on invalidate", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");
    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    // Re-reading three pages is three requests, each derived from the page
    // before it — and issued only once that page has come back.
    const gated = gatedFetcher(10);
    await act(async () => {
      app.root.render(feedApp(lane, gated.fetchPage));
      await settlePromiseHandlers();
    });

    await click(() => handle?.invalidate());
    expect(gated.pending()).toEqual([0]);

    await gated.resolveNext();
    expect(gated.pending()).toEqual([1]);

    await gated.resolveNext();
    expect(gated.pending()).toEqual([2]);

    await gated.resolveNext();
    await waitForText(app.container, "0,1,2|more");
    expect(gated.fetchPage).toHaveBeenCalledTimes(3);
  });

  it("keeps the loaded pages on screen while a re-read converges", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");

    const gated = gatedFetcher(10);
    await act(async () => {
      app.root.render(feedApp(lane, gated.fetchPage));
      await settlePromiseHandlers();
    });

    await click(() => handle?.invalidate());
    // Mid-refresh: the previous pages are still rendered, no fallback.
    expect(app.container.textContent).toBe("0,1|more");
    expect(handle?.isInvalidationPending).toBe(true);

    await gated.resolveNext();
    await gated.resolveNext();
    await waitForText(app.container, "0,1|more");
    expect(handle?.isInvalidationPending).toBe(false);
  });

  it("marks the reader pending while loadMore is in flight", async () => {
    const lane = createLane();
    const first = pageFetcher(10);

    const app = await render(feedApp(lane, first));
    await waitForText(app.container, "0|more");

    const gated = gatedFetcher(10);
    await act(async () => {
      app.root.render(feedApp(lane, gated.fetchPage));
      await settlePromiseHandlers();
    });

    await click(() => handle?.loadMore());
    expect(handle?.isInvalidationPending).toBe(true);
    expect(app.container.textContent).toBe("0|more");

    await gated.resolveNext();
    await waitForText(app.container, "0,1|more");
    expect(handle?.isInvalidationPending).toBe(false);
  });

  it("treats a null initialCursor as a cursor, not as the end", async () => {
    // An API whose first page carries no cursor nominates `null` as the initial
    // one. Only a *derived* cursor ends the walk — testing the first would load
    // nothing at all.
    const lane = createLane();
    const fetchPage = vi.fn(async (cursor: number | null) => ({
      index: cursor ?? 0,
      next: (cursor ?? 0) + 1,
    }));

    const app = await render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(NullCursorProbe, { fetchPage }),
        ),
      }),
    );

    await waitForText(app.container, "0");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it("stops early when a re-derived cursor comes back null", async () => {
    const lane = createLane();
    // A list that is three pages deep…
    const fetchPage = pageFetcher(10);
    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");
    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    // …over a source that has shrunk to two. The walk stops where the chain
    // ends instead of inventing a third page: the list is genuinely shorter.
    const shrunk = pageFetcher(2);
    await act(async () => {
      app.root.render(feedApp(lane, shrunk));
      await settlePromiseHandlers();
    });

    await click(() => handle?.invalidate());
    await waitForText(app.container, "0,1|end");
    expect(shrunk).toHaveBeenCalledTimes(2);
  });

  it("reports the end of the list and makes loadMore a no-op there", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(2);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|end");
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|end");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("re-reads the full depth after a remount over the cached value", async () => {
    // The regression this hook exists for: depth comes from the cached value, so
    // a component that remounts over a three-page cache still refreshes three
    // pages instead of silently truncating the list to one.
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");
    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");
    expect(fetchPage).toHaveBeenCalledTimes(3);

    // Unmount the reader, then mount a fresh one over the same lane.
    await act(async () => {
      app.root.render(React.createElement(LaneProvider, { children: null, lane }));
      await settlePromiseHandlers();
    });
    await act(async () => {
      app.root.render(feedApp(lane, fetchPage));
      await settlePromiseHandlers();
    });

    // The cached value comes back whole, with no request at all.
    await waitForText(app.container, "0,1,2|more");
    expect(fetchPage).toHaveBeenCalledTimes(3);

    // And the depth came back with it.
    await click(() => handle?.invalidate());
    await waitForText(app.container, "0,1,2|more");
    expect(fetchPage).toHaveBeenCalledTimes(6);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);
  });

  it("keeps the pages and reports error when a re-read fails", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(10);

    const app = await render(feedApp(lane, fetchPage));
    await waitForText(app.container, "0|more");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");

    const failing = vi.fn(async (cursor: number) => {
      if (cursor === 1) {
        throw new Error("offline");
      }
      return { index: cursor, next: cursor + 1 };
    });
    await act(async () => {
      app.root.render(feedApp(lane, failing));
      await settlePromiseHandlers();
    });

    await click(() => handle?.invalidate());
    // Both pages are still there, the failure rides alongside them, and nothing
    // was thrown to a boundary.
    await waitForText(app.container, "0,1|more|offline");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("throws an initial-load failure to the error boundary", async () => {
    const lane = createLane();
    const fetchPage = vi.fn(async () => {
      throw new Error("cold");
    });

    const app = await render(
      feedApp(lane, fetchPage as unknown as PageFetcher),
    );

    await waitForText(app.container, "caught:cold");
  });
});

/**
 * The list the issue is about: page 1 belongs to the route (published through
 * `<LaneHydration>`), depth belongs to the browser (`loadMore`), one key.
 */
describe("an infinite list whose first page the route publishes", () => {
  it("takes page 1 from the publication, and never fetches it", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const fetchPage = (pageSource = pageFetcher(10));
    const app = await renderRouteFeed(lane, feedSnapshots(page(0)));

    // No first load at all: `loader: external` builds no cursor walk, so the
    // only thing that can fill the key is its owner.
    expect(app.container.textContent).toBe("0|more");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("appends page 2 into the seat the publication holds", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const fetchPage = (pageSource = pageFetcher(10));
    const snapshots = feedSnapshots(page(0));
    const app = await renderRouteFeed(lane, snapshots);

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");

    // Page 2 is the browser's, fetched from the cursor page 1 carried.
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([1]);

    // And it sits where the published page 1 sat, so the deepened list lives
    // exactly as long as the payload it extends.
    const bucket = publishedBy(snapshots);

    expect(bucket).toHaveLength(1);
    await expect(bucket?.[0]).resolves.toEqual({
      revision: expect.any(Number),
      data: { hasNext: true, pages: [page(0), page(1)], params: [0, 1] },
    });
  });

  it("starts again at the published page on any republication", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    pageSource = pageFetcher(10);
    const app = await renderRouteFeed(lane, feedSnapshots(page(0)));

    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    frames.length = 0;

    // A new payload — a navigation, a `refresh` — carrying a page 1 deep-equal
    // to the one standing there. It replaces the key all the same: the store
    // never asks whether a publication looks like what it holds, because it
    // cannot tell an unchanged page from one changed and changed back.
    await renderRouteFeed(lane, feedSnapshots(page(0)), { app });

    expect(app.container.textContent).toBe("0|more");
    expect(frames).toEqual(["0|more"]);

    // And the list the browser deepens from here is the published one: the
    // next append walks on from the cursor the publication carried.
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");
  });

  it("starts again when the published page 1 differs", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    pageSource = pageFetcher(10);
    const app = await renderRouteFeed(lane, feedSnapshots(page(0)));

    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    // The list starts somewhere else now, so the cursors behind the old page 1
    // describe nothing. The publication stands alone — as it always does.
    await renderRouteFeed(lane, feedSnapshots({ index: 100, next: 101 }), {
      app,
    });

    expect(app.container.textContent).toBe("100|more");
  });

  it("keeps the depth through writes that do not republish the key", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    pageSource = pageFetcher(10);
    const app = await renderRouteFeed(lane, feedSnapshots(page(0)));

    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    // What a mutation does to the keys around the list: converge the row it
    // touched, mark what derives from it stale. None of that publishes the
    // list's key, so the depth the browser added is nobody's business but the
    // browser's.
    await click(() => {
      lane.set(["task", 1], "confirmed");
      lane.set(["insights"], "stale-soon");
      void lane.update(["task", 1], (value: string) => `${value}!`);
      lane.invalidate(["insights"]);
    });

    expect(app.container.textContent).toBe("0,1,2|more");
  });

  it("asks the owner on invalidate, and takes the answer at depth 1", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane();
    pageSource = pageFetcher(10);
    const app = await renderRouteFeed(lane, feedSnapshots(page(0)), {
      refresh,
    });

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more");

    await click(() => handle?.invalidate());
    expect(refresh).toHaveBeenCalledTimes(1);

    // The owner publishes the same page 1 — and this time the depth goes with
    // the invalidation: saying "this key is stale" says it about pages 2..n too.
    await renderRouteFeed(lane, feedSnapshots(page(0)), { app, refresh });

    expect(app.container.textContent).toBe("0|more");
  });

  it("a publication landing while hidden replaces the depth too", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const fetchPage = (pageSource = pageFetcher(10));
    const first = feedSnapshots(page(0));
    const app = await renderRouteFeed(lane, first);

    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more");

    // Hidden: the reader is unsubscribed, so nothing can tell it anything.
    await renderRouteFeed(lane, first, { app, mode: "hidden" });

    const fetchesBeforePublish = fetchPage.mock.calls.length;
    const second = feedSnapshots(page(0));

    await renderRouteFeed(lane, second, { app, mode: "hidden" });

    // Measured after the publication has landed: the claim is about the reveal,
    // and the hidden tree's own hydration boundary suspends like any other.
    const fallbacksBeforeReveal = fallbackRenders;

    await renderRouteFeed(lane, second, { app, mode: "visible" });

    // The publication landed on an entry nobody was there to receive it — and
    // it replaced the value all the same. The reveal shows what the owner last
    // said, at the depth the owner said it, with nothing left to fetch.
    expect(app.container.textContent).toBe("0|more");
    expect(fallbackRenders).toBe(fallbacksBeforeReveal);
    expect(fetchPage).toHaveBeenCalledTimes(fetchesBeforePublish);
  });
});

type PageFetcher = ReturnType<typeof pageFetcher>;

/** Resolves immediately; `total` decides where the cursor chain ends. */
function pageFetcher(total: number) {
  return vi.fn(async (cursor: number): Promise<Page> => ({
    index: cursor,
    next: cursor + 1 < total ? cursor + 1 : null,
  }));
}

/**
 * Same shape, but every page hangs until the test releases it — the only way to
 * prove that page N+1 was not requested until page N came back.
 */
function gatedFetcher(total: number) {
  const gates: { cursor: number; gate: ReturnType<typeof deferred<Page>> }[] = [];

  const fetchPage = vi.fn((cursor: number): Promise<Page> => {
    const gate = deferred<Page>();
    gates.push({ cursor, gate });
    return gate.promise;
  });

  return {
    fetchPage,
    /** Cursors currently in flight. */
    pending: () =>
      gates.filter(({ gate }) => !settled.has(gate)).map(({ cursor }) => cursor),
    async resolveNext() {
      const next = gates.find(({ gate }) => !settled.has(gate));

      if (!next) {
        throw new Error("nothing in flight");
      }

      settled.add(next.gate);
      await act(async () => {
        next.gate.resolve({
          index: next.cursor,
          next: next.cursor + 1 < total ? next.cursor + 1 : null,
        });
        await settlePromiseHandlers();
      });
    },
  };
}

const settled = new WeakSet<object>();

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
        `caught:${caughtMessage(this.state.error)}`,
      );
    }

    return this.props.children;
  }
}

/** A feed whose first page carries no cursor at all. */
function NullCursorProbe({
  fetchPage,
}: {
  fetchPage: (cursor: number | null) => Promise<Page>;
}) {
  const { promise } = useInfiniteLane<Page, number | null>({
    key: ["null-cursor"],
    fetchPage: (cursor) => fetchPage(cursor),
    initialCursor: null,
    nextCursor: (page) => page.next,
  });

  const { data } = React.use(promise);

  return React.createElement(
    React.Fragment,
    null,
    data.pages.map((page) => page.index).join(","),
  );
}

function FeedProbe({
  fetchPage,
  options,
}: {
  fetchPage: PageFetcher;
  options?: LaneUseOptions;
}) {
  const result = useInfiniteLane<Page, number>({
    ...options,
    key: ["feed"],
    fetchPage: (cursor) => fetchPage(cursor),
    initialCursor: 0,
    nextCursor: (page) => page.next,
  });

  React.useEffect(() => {
    handle = result;
  });

  const { data, error } = React.use(result.promise);
  const rendered = [
    data.pages.map((page) => page.index).join(","),
    data.hasNext ? "more" : "end",
  ];

  if (error) {
    rendered.push((error as Error).message);
  }

  return React.createElement(React.Fragment, null, rendered.join("|"));
}

function feedApp(
  lane: Lane,
  fetchPage: PageFetcher,
  options?: LaneUseOptions,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      CatchBoundary,
      null,
      React.createElement(
        React.Suspense,
        { fallback: "loading" },
        React.createElement(FeedProbe, { fetchPage, options }),
      ),
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

/** Run a handle action the way an event handler would, then let React settle. */
async function click(action: () => void): Promise<void> {
  await act(async () => {
    action();
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

/** One page of the ten-page feed the route publishes. */
function page(index: number, total = 10): Page {
  return { index, next: index + 1 < total ? index + 1 : null };
}

/**
 * The route-published list: `loader: external`, so page 1 arrives by
 * publication and there is no `initialCursor` to give — the published value
 * carries the cursor it was fetched with. `fetchPage` / `nextCursor` are what
 * `loadMore` runs on, and nothing else.
 */
const routeFeed = infiniteLaneRead<Page, number>({
  key: ["route-feed"],
  loader: external,
  fetchPage: (cursor) => {
    if (!pageSource) {
      throw new Error("this test published no page source");
    }

    return pageSource(cursor);
  },
  nextCursor: (feedPage) => feedPage.next,
});

/**
 * What a Server Component hands `<LaneHydration>`: one page, converted to the
 * value the key holds — the one place that conversion happens.
 */
function feedSnapshots(first: Page): LaneHydrationSnapshots {
  return { entries: [infiniteLaneSnapshot(routeFeed, first, 0)] };
}

function Fallback() {
  fallbackRenders += 1;

  return React.createElement("span", null, "loading");
}

function RouteFeedProbe() {
  const result = useInfiniteLane(routeFeed);

  React.useEffect(() => {
    handle = result;
  });

  const { data, error } = React.use(result.promise);
  const rendered = [
    data.pages.map((feedPage) => feedPage.index).join(","),
    data.hasNext ? "more" : "end",
  ];

  if (error) {
    rendered.push((error as Error).message);
  }

  const text = rendered.join("|");

  // What this reader committed, whenever it commits — the log a "never showed
  // the shallow list" claim has to be made against.
  React.useLayoutEffect(() => {
    if (frames[frames.length - 1] !== text) {
      frames.push(text);
    }
  });

  return React.createElement(React.Fragment, null, text);
}

function routeFeedApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
  mode: Mode,
  refresh: (() => void) | undefined,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    refresh,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(LaneHydration, {
          children: React.createElement(RouteFeedProbe, null),
          snapshots,
        }),
      ),
      mode,
    }),
  });
}

/**
 * Render the route-published feed and let its publication land: `LaneHydration`
 * publishes from a macrotask and suspends until it has. Pass `app` to re-render
 * the same tree — where a new `snapshots` object is a republication.
 */
async function renderRouteFeed(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
  options: { app?: RenderedApp; mode?: Mode; refresh?: () => void } = {},
): Promise<RenderedApp> {
  const app = options.app ?? mountApp();

  await act(async () => {
    app.root.render(
      routeFeedApp(lane, snapshots, options.mode ?? "visible", options.refresh),
    );
    await settlePromiseHandlers();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    await settlePromiseHandlers();
  });

  return app;
}

function mountApp(): RenderedApp {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  return { container, root };
}
