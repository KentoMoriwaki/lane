// @vitest-environment jsdom

/**
 * React's promise cache protocol (react.dev, `use` → "How to implement a
 * promise cache"): a promise carries its own settlement as `status` / `value`,
 * and `use()` reads a settled one in the render that receives it instead of
 * suspending once to learn what it holds.
 *
 * Lane writes those fields in exactly one place — a value it was handed
 * synchronously, which is `set(key, value)` and a `<LaneHydration>` seed. That
 * covers the path that cannot wait a microtask: a reveal adopts the store's
 * promise from a layout effect, a synchronous update, so an unstamped promise
 * commits the boundary's fallback and comes back on a retry React throttles
 * fallbacks on for 300ms.
 *
 * A promise is left exactly as it arrived. A loader's result, `set(key,
 * promise)`, an `update` chain, `prefetch` — those are somebody else's promise
 * passed through, and the store has nothing to say about them that it can say
 * synchronously. React stamps them itself on their first `use()`, which is one
 * suspend later, and that is the accepted cost.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLane, LaneProvider } from "../index";
import { hydrateMany, publishedBy } from "../hydrate";
import type { Lane, LaneHydrationSnapshots, LaneRead } from "../types";
import {
  deferred,
  readOrCreate,
  resetVitest,
  settlePromiseHandlers,
} from "./test-utils";

/**
 * The protocol's fields, read off a promise. Optional because "not stamped at
 * all" is the state most of these tests have to be able to describe.
 */
type Stamped<T> = Promise<T> & {
  status?: string;
  value?: T;
};

function stamps<T>(promise: Promise<T>): Stamped<T> {
  return promise as Stamped<T>;
}

const roots: Root[] = [];

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

  document.body.innerHTML = "";
  fallbackRenders = 0;
  resetVitest();
});

describe("a value the store received synchronously", () => {
  it("is fulfilled the moment set returns it, with no microtask in between", () => {
    const lane = createLane();
    const promise = lane.set(["tasks"], "v1");

    // No `await` anywhere above this line.
    expect(stamps(promise).status).toBe("fulfilled");
    expect(stamps(promise).value).toEqual({
      data: "v1",
      revision: expect.any(Number),
    });
  });

  it("is fulfilled the moment a publication seeds it", () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    hydrateMany(lane, snapshots);

    const [seeded] = publishedBy(snapshots) ?? [];

    expect(seeded).toBeDefined();
    expect(stamps(seeded as Promise<LaneRead<string>>).status).toBe("fulfilled");
    expect(stamps(seeded as Promise<LaneRead<string>>).value).toEqual({
      data: "server-1",
      revision: expect.any(Number),
    });
  });

  it("goes through the same bookkeeping the loaded path does", async () => {
    const lane = createLane({ gcTime: Infinity });

    const first = await lane.set(["tasks"], { title: "Write" });
    const second = await lane.set(["tasks"], { title: "Write" });

    // Structural sharing collapsed a deep-equal write, so the revision names
    // the same content it named before and the data is the same reference —
    // exactly what a loader returning the same shape gets.
    expect(second.data).toBe(first.data);
    expect(second.revision).toBe(first.revision);

    const third = await lane.set(["tasks"], { title: "Ship" });

    expect(third.revision).not.toBe(first.revision);
  });
});

describe("a promise the store was handed", () => {
  it("carries no stamps of Lane's own, settled or not", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const loaded = readOrCreate(lane, ["tasks"], () => load.promise);

    await settlePromiseHandlers();
    expect(stamps(loaded).status).toBeUndefined();

    load.resolve("v1");
    await loaded;

    // Still nothing: the store never touched it, and nothing has `use()`d it,
    // which is the only other thing that would write these fields.
    expect(stamps(loaded).status).toBeUndefined();
    expect(stamps(loaded).value).toBeUndefined();
  });

  it("is left alone when set is given one rather than a value", async () => {
    const lane = createLane();
    const published = lane.set(["tasks"], Promise.resolve("v1"));

    await published;

    expect(stamps(published).status).toBeUndefined();
  });
});

describe("a synchronous adoption", () => {
  it("reads a set value without ever showing the fallback", async () => {
    const lane = createLane();
    // Written as a value and never handed to `use()` — the state a reveal
    // finds after a mutation landed behind a hidden tree.
    const promise = lane.set(["tasks"], "v1");

    const container = await renderAdoption(lane, promise);

    expect(container.textContent).toBe("v1");
    expect(fallbackRenders).toBe(0);
  });

  it("shows the fallback for an un-instrumented promise of the same value", async () => {
    const lane = createLane();
    // The control: a plain promise of the very same read. Everything else about
    // the render is identical, so the fallback below is the stamps and nothing
    // else.
    const plain = Promise.resolve(await lane.set(["tasks"], "v1"));

    const container = await renderAdoption(lane, plain);

    expect(container.textContent).toBe("v1");
    expect(fallbackRenders).toBeGreaterThan(0);
  });

  it("shows the fallback for a settled prefetch nothing has read", async () => {
    const lane = createLane();
    const promise = lane.prefetch({
      key: ["tasks"],
      loader: async () => "warm",
    });

    await promise;

    // The boundary of the rule, pinned so the docs stay honest: warming runs a
    // loader, so what the store holds is the loader's promise, and nothing has
    // `use()`d it. React stamps it on the first `use()` — one suspend later,
    // and this adoption is synchronous, so that suspend is a committed
    // fallback. Warming saves the request; it does not buy a flash-free
    // synchronous reveal. `set` the value, or have something read the key.
    const container = await renderAdoption(lane, promise);

    expect(container.textContent).toBe("warm");
    expect(fallbackRenders).toBeGreaterThan(0);
  });
});

/**
 * A tree that commits a placeholder and then adopts `promise` from a layout
 * effect — a synchronous update over already-committed content, which is what a
 * reveal does and what cannot wait for a microtask.
 */
function AdoptOnLayout({ promise }: { promise: Promise<LaneRead<string>> }) {
  const [adopted, setAdopted] = React.useState<
    Promise<LaneRead<string>> | undefined
  >(undefined);

  React.useLayoutEffect(() => {
    setAdopted(promise);
  }, [promise]);

  return React.createElement(
    "div",
    null,
    adopted ? React.use(adopted).data : "placeholder",
  );
}

function Fallback() {
  fallbackRenders += 1;

  return React.createElement("span", null, "loading");
}

async function renderAdoption(
  lane: Lane,
  promise: Promise<LaneRead<string>>,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  await act(async () => {
    root.render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: React.createElement(Fallback) },
          React.createElement(AdoptOnLayout, { promise }),
        ),
      }),
    );
    await settlePromiseHandlers();
  });

  return container;
}
