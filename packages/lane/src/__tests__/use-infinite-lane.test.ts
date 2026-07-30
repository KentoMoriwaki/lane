// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useInfiniteLane } from "../index";
import type { InfiniteLaneResult } from "../use-infinite-lane";
import type { Lane, LaneUseOptions } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

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
 * That distinction matters for `isTransitionPending`: inside the transition's
 * own render (the future tree, which suspends and never commits here) the flag
 * is already `false`, because that render is what the screen looks like once the
 * transition is done. The pending screen is the committed one.
 */
let handle: Handle | null = null;

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
    expect(handle?.isTransitionPending).toBe(true);

    await gated.resolveNext();
    await gated.resolveNext();
    await waitForText(app.container, "0,1|more");
    expect(handle?.isTransitionPending).toBe(false);
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
    expect(handle?.isTransitionPending).toBe(true);
    expect(app.container.textContent).toBe("0|more");

    await gated.resolveNext();
    await waitForText(app.container, "0,1|more");
    expect(handle?.isTransitionPending).toBe(false);
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

  it("keeps the pages and reports refreshError when a re-read fails", async () => {
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
        `caught:${this.state.error.message}`,
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

  const { data, refreshError } = React.use(result.promise);
  const rendered = [
    data.pages.map((page) => page.index).join(","),
    data.hasNext ? "more" : "end",
  ];

  if (refreshError) {
    rendered.push((refreshError as Error).message);
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
