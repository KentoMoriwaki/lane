// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { firstPageDerivationCount, peekEntryPromise } from "../core";
import { createLane, LaneProvider, useInfiniteLane } from "../index";
import { serializeKey } from "../keys";
import type { InfiniteLaneResult, InfiniteLaneValue } from "../use-infinite-lane";
import type { Lane, LaneRead } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

/**
 * The `firstPage` option — a list whose page 1 belongs to someone else.
 *
 * Two questions run through all of it. *Does the walk skip page 1?* — asserted
 * on the fetcher, which must never be called with the first cursor. *Does a new
 * first page reset the list while an unchanged one leaves it alone?* — asserted
 * on the rendered depth **and** the fetcher's call count, because "kept the
 * depth" and "reset and refetched everything" look identical if you only read
 * the text.
 *
 * The probe prints `pages|hasNext|mark-of-page-1`, so one string says which
 * generation of the first page the list is standing on. Pages the client fetched
 * are marked `fetched`; pages handed in are marked with their version.
 */

type Page = { index: number; next: number | null; mark: string };

type Handle = InfiniteLaneResult<Page, number>;

const FEED_ID = serializeKey(["feed"]);

const roots: Root[] = [];
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

describe("useInfiniteLane firstPage", () => {
  it("adopts the first page at entry creation, fetching nothing for it", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));

    await waitForText(app.container, "0|more|a");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("walks pages 2..N and never page 1", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more|a");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more|a");

    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([1, 2]);
  });

  it("does nothing at all when the version is unchanged", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more|a");

    // A republication that changed nothing: a brand-new page *object* under the
    // same content identity, which is exactly what an RSC prop looks like after
    // a refresh over a warm cache.
    await rerender(app, feedApp(lane, fetchPage, firstPage("a")));

    await waitForText(app.container, "0,1|more|a");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(firstPageDerivationCount(lane)).toBe(0);
  });

  it("resets to depth 1 on a new version, with no request", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");
    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more|a");
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await rerender(app, feedApp(lane, fetchPage, firstPage("b")));

    await waitForText(app.container, "0|more|b");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("leaves the entry alone until a commit adopts the fork, and re-forks to the same promise on retry", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();
    const gate = deferred<void>();
    const seen: Promise<unknown>[] = [];

    const app = await render(
      gatedFeedApp(lane, fetchPage, firstPage("a"), seen, undefined),
    );
    await waitForText(app.container, "0|more|a");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more|a");
    seen.length = 0;

    // The new first page arrives in the same render as a sibling that suspends,
    // so the forking render is thrown away and retried when the gate opens.
    await rerender(
      app,
      gatedFeedApp(lane, fetchPage, firstPage("b"), seen, gate.promise),
    );

    // The boundary fell back: nothing committed. The entry must still be the
    // two-page list the previous first page anchored — a fork that wrote to the
    // store during render would already have replaced it.
    expect(app.container.textContent).toBe("loading");
    const during = await peek(lane);
    expect(during.pages.map((page) => page.index)).toEqual([0, 1]);
    expect(during.pages[0]?.mark).toBe("a");

    await act(async () => {
      gate.resolve();
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "0|more|b");

    // Every attempt at the forking render was handed the *same* promise. A
    // `useState` or `useMemo` here would mint a second one on the retry and the
    // reader would suspend again on a value it already had.
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("hands the same fork to a StrictMode double render", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();
    const seen: Promise<unknown>[] = [];

    const app = await render(
      strictFeedApp(lane, fetchPage, firstPage("a"), seen),
    );
    await waitForText(app.container, "0|more|a");
    seen.length = 0;

    await rerender(app, strictFeedApp(lane, fetchPage, firstPage("b"), seen));
    await waitForText(app.container, "0|more|b");

    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it("stamps the version on the entry and drops the fork once adopted", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");

    await rerender(app, feedApp(lane, fetchPage, firstPage("b")));
    await waitForText(app.container, "0|more|b");

    // Stamped: further renders at the same version fork nothing, so an appended
    // page survives them.
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more|b");
    await rerender(app, feedApp(lane, fetchPage, firstPage("b")));
    await waitForText(app.container, "0,1|more|b");

    // Dropped: no row left for either version.
    expect(firstPageDerivationCount(lane)).toBe(0);
  });

  it("aborts an in-flight loadMore when a new first page is adopted", async () => {
    const lane = createLane();
    const gate = deferred<Page>();
    const fetchPage = vi.fn((cursor: number) =>
      cursor === 1 ? gate.promise : Promise.resolve(page(cursor, "fetched")),
    );

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");

    await act(async () => {
      handle?.loadMore();
      await settlePromiseHandlers();
    });

    await rerender(app, feedApp(lane, fetchPage, firstPage("b")));
    await waitForText(app.container, "0|more|b");

    // The append lands late. It was deepening the list the *previous* first page
    // anchored, so it must not resurrect it.
    await act(async () => {
      gate.resolve(page(1, "fetched"));
      await settlePromiseHandlers();
    });

    await waitForText(app.container, "0|more|b");
    const value = await peek(lane);
    expect(value.pages.map((page) => page.mark)).toEqual(["b"]);
  });

  it("re-walks pages 2..N on invalidate and takes page 1 for free", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");
    await click(() => handle?.loadMore());
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more|a");
    fetchPage.mockClear();

    await click(() => handle?.invalidate());
    await waitForText(app.container, "0,1,2|more|a");

    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([1, 2]);
  });

  it("invalidate adopts the first page the latest render was given", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher();

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");

    // Same content identity, a newer object: the entry keeps the one it has.
    await rerender(
      app,
      feedApp(lane, fetchPage, { value: page(0, "a2"), version: "a" }),
    );
    await waitForText(app.container, "0|more|a");

    // The re-walk is where the newer object wins — the loader closes over the
    // latest committed render's `firstPage`, not the one the entry was built
    // from.
    await click(() => handle?.invalidate());
    await waitForText(app.container, "0|more|a2");
  });

  it("keeps loadMore working normally over an adopted first page", async () => {
    const lane = createLane();
    const fetchPage = pageFetcher(3);

    const app = await render(feedApp(lane, fetchPage, firstPage("a")));
    await waitForText(app.container, "0|more|a");

    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1|more|a");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2|more|a");
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2,3|end|a");

    // At the end of the list a further click costs nothing.
    await click(() => handle?.loadMore());
    await waitForText(app.container, "0,1,2,3|end|a");
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

/* ------------------------------- fixtures ------------------------------- */

function page(index: number, mark: string, last = 10): Page {
  return { index, mark, next: index >= last ? null : index + 1 };
}

function firstPage(mark: string) {
  return { value: page(0, mark), version: mark };
}

function pageFetcher(last = 10) {
  return vi.fn((cursor: number) =>
    Promise.resolve(page(cursor, "fetched", last)),
  );
}

type FirstPageProp = { value: Page; version: string };

function FeedProbe({
  fetchPage,
  first,
  seen,
}: {
  fetchPage: (cursor: number) => Promise<Page>;
  first: FirstPageProp;
  seen?: Promise<unknown>[];
}) {
  const result = useInfiniteLane<Page, number>({
    key: ["feed"],
    initialCursor: 0,
    firstPage: first,
    fetchPage: (cursor) => fetchPage(cursor),
    nextCursor: (page) => page.next,
  });

  seen?.push(result.promise);

  React.useEffect(() => {
    handle = result;
  });

  const { data } = React.use(result.promise);

  return React.createElement(
    React.Fragment,
    null,
    [
      data.pages.map((page) => page.index).join(","),
      data.hasNext ? "more" : "end",
      data.pages[0]?.mark ?? "-",
    ].join("|"),
  );
}

/**
 * A sibling that suspends on demand — rendered *after* the probe, so the probe
 * has already forked by the time the boundary falls back and the whole render
 * is thrown away.
 */
function Gate({ gate }: { gate: Promise<void> | undefined }) {
  if (gate) {
    React.use(gate);
  }

  return null;
}

function feedApp(
  lane: Lane,
  fetchPage: (cursor: number) => Promise<Page>,
  first: FirstPageProp,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(FeedProbe, { fetchPage, first }),
    ),
  });
}

function strictFeedApp(
  lane: Lane,
  fetchPage: (cursor: number) => Promise<Page>,
  first: FirstPageProp,
  seen: Promise<unknown>[],
): React.ReactElement {
  return React.createElement(
    React.StrictMode,
    null,
    React.createElement(LaneProvider, {
      lane,
      children: React.createElement(
        React.Suspense,
        { fallback: "loading" },
        React.createElement(FeedProbe, { fetchPage, first, seen }),
      ),
    }),
  );
}

function gatedFeedApp(
  lane: Lane,
  fetchPage: (cursor: number) => Promise<Page>,
  first: FirstPageProp,
  seen: Promise<unknown>[],
  gate: Promise<void> | undefined,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: "loading" },
      React.createElement(FeedProbe, { fetchPage, first, seen }),
      React.createElement(Gate, { gate }),
    ),
  });
}

/* -------------------------------- driving ------------------------------- */

type RenderedApp = { container: HTMLDivElement; root: Root };

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

async function rerender(
  app: RenderedApp,
  element: React.ReactElement,
): Promise<void> {
  await act(async () => {
    app.root.render(element);
    await settlePromiseHandlers();
  });
}

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

    await act(async () => {
      await settlePromiseHandlers();
    });
  }

  expect(container.textContent).toBe(expected);
}

/**
 * The store's own copy of the list, read without a reader — the only way to
 * assert that the entry was *not* written, since every public surface would
 * have to render, which is the thing under test.
 */
async function peek(lane: Lane): Promise<InfiniteLaneValue<Page, number>> {
  const promise = peekEntryPromise(lane, FEED_ID) as
    | Promise<LaneRead<InfiniteLaneValue<Page, number>>>
    | undefined;

  if (!promise) {
    throw new Error("the feed entry holds nothing");
  }

  return (await promise).data;
}
