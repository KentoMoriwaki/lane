// @vitest-environment jsdom

/**
 * React's promise cache protocol (react.dev, `use` → "How to implement a
 * promise cache"): a promise carries its own settlement as `status` / `value` /
 * `reason`, and `use()` reads a settled one in the render that receives it
 * instead of suspending once to learn what it holds.
 *
 * Lane writes those fields on every promise it hands a reader, because the one
 * path that cannot wait a microtask is the one this is for: a reveal adopts the
 * store's promise from a layout effect, which is a synchronous update. A
 * synchronous render has nowhere to wait, so an unstamped promise — however
 * long it has been settled — commits the boundary's fallback, and the retry
 * runs on the lane React throttles fallbacks on for 300ms.
 *
 * React skips its own instrumentation as soon as `status` is a string, so
 * writing `"pending"` is a promise to write the settlement too. These tests are
 * that promise, kept for every way a promise leaves the store.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLane,
  external,
  LaneExternalTimeoutError,
  LaneProvider,
  LaneReadError,
} from "../index";
import { hydrateMany, publishedBy } from "../hydrate";
import type { Lane, LaneHydrationSnapshots, LaneRead } from "../types";
import {
  deferred,
  readOrCreate,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
  subscribeInvalidate,
} from "./test-utils";

/**
 * The protocol's three fields, read off a promise. Optional because "not
 * stamped at all" is the state the negative control below has to be able to
 * describe.
 */
type Stamped<T> = Promise<T> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
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

describe("every promise the store hands out", () => {
  it("says it is pending until it settles", async () => {
    const lane = createLane();
    const load = deferred<string>();
    const promise = readOrCreate(lane, ["tasks"], () => load.promise);

    await settlePromiseHandlers();
    expect(stamps(promise).status).toBe("pending");

    load.resolve("v1");
    await promise;

    expect(stamps(promise).status).toBe("fulfilled");
  });

  it("carries the read it resolved with", async () => {
    const lane = createLane();
    const promise = readOrCreate(lane, ["tasks"], async () => "v1");
    const read = await promise;

    // The same object, not an equal one: `value` is what `use()` returns.
    expect(stamps(promise).status).toBe("fulfilled");
    expect(stamps(promise).value).toBe(read);
    expect(read).toEqual({ data: "v1", revision: expect.any(Number) });
  });

  it("carries the error it rejected with, wrapped for a client key", async () => {
    const lane = createLane();
    const failure = new Error("offline");
    const promise = readOrCreate(lane, ["tasks"], async () => {
      throw failure;
    });

    await expect(promise).rejects.toThrow(LaneReadError);

    expect(stamps(promise).status).toBe("rejected");
    expect(stamps(promise).reason).toBeInstanceOf(LaneReadError);
    expect((stamps(promise).reason as LaneReadError).cause).toBe(failure);
  });

  it("carries an external key's error unwrapped", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const promise = readOrCreate(lane, ["task", "t1"], external);

    promise.catch(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(stamps(promise).status).toBe("rejected");
    expect(stamps(promise).reason).toBeInstanceOf(LaneExternalTimeoutError);
  });

  it("stamps what update and updateAll hand back", async () => {
    const lane = createLane();

    await lane.set(["tasks", "a"], "a1");
    await lane.set(["tasks", "b"], "b1");

    const updated = lane.update<string>(["tasks", "a"], (data) => `${data}+`);
    const all = lane.updateAll<string>(["tasks"], (data) => `${data}!`);

    await Promise.all([updated, ...all]);

    // Both chain onto the entry's in-flight promise, so both go the async way
    // round and are stamped on settlement rather than at creation.
    expect(stamps(updated as Promise<LaneRead<string>>).status).toBe("fulfilled");
    expect(all).toHaveLength(2);

    for (const promise of all) {
      expect(stamps(promise).status).toBe("fulfilled");
    }
  });

  it("stamps what prefetch warms", async () => {
    const lane = createLane();
    const promise = lane.prefetch({ key: ["tasks"], loader: async () => "warm" });

    await promise;

    expect(stamps(promise).status).toBe("fulfilled");
    expect(stamps(promise).value).toEqual({
      data: "warm",
      revision: expect.any(Number),
    });
  });
});

describe("a value already in hand", () => {
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

describe("a read with nothing of its own to serve", () => {
  it("is fulfilled when a fallback policy answers for it", async () => {
    const lane = createLane();
    const failure = new Error("offline");
    const promise = readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw failure;
      },
      { fallback: () => "empty" },
    );

    await promise;

    expect(stamps(promise).status).toBe("fulfilled");
    expect(stamps(promise).value).toEqual({
      data: "empty",
      error: failure,
      revision: expect.any(Number),
    });
  });

  it("is fulfilled when a cancel reverts it to the last value", async () => {
    const lane = createLane();
    subscribe(lane, ["tasks"]);

    await readOrCreate(lane, ["tasks"], async () => "v1");
    subscribeInvalidate(lane, ["tasks"], vi.fn());
    lane.invalidate(["tasks"]);

    // Forwards the signal, the way a loader handing it to `fetch` does.
    const refresh = readOrCreate(
      lane,
      ["tasks"],
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );

    await settlePromiseHandlers();
    lane.cancel(["tasks"]);
    await refresh;

    // A cancel is the caller's own stop, so the reverted read carries no
    // `error` — and it is a fulfilled read like any other.
    expect(stamps(refresh).status).toBe("fulfilled");
    expect(stamps(refresh).value).toEqual({
      data: "v1",
      revision: expect.any(Number),
    });
  });
});

describe("a synchronous adoption", () => {
  it("reads a settled Lane promise without ever showing the fallback", async () => {
    const lane = createLane();
    // Warmed outside React and never handed to `use()`: the state the store's
    // own stamps have to answer for, since React has never seen this promise.
    const promise = lane.prefetch({
      key: ["tasks"],
      loader: async () => "warm",
    });

    await promise;

    const container = await renderAdoption(lane, promise);

    expect(container.textContent).toBe("warm");
    expect(fallbackRenders).toBe(0);
  });

  it("shows it for an un-instrumented promise of the same value", async () => {
    const lane = createLane();
    const promise = lane.prefetch({
      key: ["tasks"],
      loader: async () => "warm",
    });
    // The control: a plain promise of the very same read. Everything else about
    // the render is identical, so the fallback below is the stamps and nothing
    // else.
    const plain = Promise.resolve(await promise);

    const container = await renderAdoption(lane, plain);

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
