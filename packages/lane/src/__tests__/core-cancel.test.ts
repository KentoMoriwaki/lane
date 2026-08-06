import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import type { LaneLoaderContext } from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
} from "./test-utils";

afterEach(resetVitest);

/** Never settles, and never notices the abort. */
function pendingLoader() {
  let signal: AbortSignal | undefined;
  const loader = vi.fn((context: LaneLoaderContext) => {
    signal = context.signal;
    return new Promise<string>(() => {});
  });

  return {
    loader,
    get signal() {
      return signal;
    },
  };
}

/** Honours the signal, the way a loader that forwards it to `fetch` does. */
function abortingLoader() {
  let signal: AbortSignal | undefined;
  const loader = vi.fn((context: LaneLoaderContext) => {
    signal = context.signal;
    return new Promise<string>((_resolve, reject) => {
      context.signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  });

  return {
    loader,
    get signal() {
      return signal;
    },
  };
}

describe("cancel", () => {
  it("aborts the in-flight loader", async () => {
    const lane = createLane();
    const pending = pendingLoader();

    readOrCreate(lane, ["tasks"], pending.loader);
    await settlePromiseHandlers();

    expect(pending.signal?.aborted).toBe(false);
    lane.cancel(["tasks"]);
    expect(pending.signal?.aborted).toBe(true);
  });

  it("reverts to the last fulfilled value without a refresh error", async () => {
    const lane = createLane();
    subscribe(lane, ["tasks"]);

    await readOrCreate(lane, ["tasks"], async () => "first");
    lane.invalidate(["tasks"]);

    const refresh = abortingLoader();
    const promise = readOrCreate(lane, ["tasks"], refresh.loader);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);

    // The caller asked for the stop, so it is not reported as a failed refresh.
    await expect(promise).resolves.toEqual({ revision: expect.any(Number), data: "first" });
  });

  it("is not undone by a loader that ignores its signal", async () => {
    const lane = createLane();
    subscribe(lane, ["tasks"]);

    await readOrCreate(lane, ["tasks"], async () => "first");
    lane.invalidate(["tasks"]);

    const refresh = deferred<string>();
    const promise = readOrCreate(lane, ["tasks"], () => refresh.promise);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);
    // The loader never forwarded the signal and runs to completion anyway.
    refresh.resolve("second");

    await expect(promise).resolves.toEqual({ revision: expect.any(Number), data: "first" });
  });

  it("settles rejected when there is nothing to revert to, and stays that way", async () => {
    const lane = createLane();
    const first = abortingLoader();

    const promise = readOrCreate(lane, ["tasks"], first.loader);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);

    // A reader suspended on a first load has no value to fall back to, so the
    // read ends the only way a transition holding no data can: rejected.
    await expect(promise).rejects.toThrow("aborted");

    // And the rejection is kept. Emptying the entry would quietly undo the
    // cancel: a reader mid-transition is still trying to reach this key, and
    // React's retry of the render it never committed would start a fresh load.
    const next = vi.fn(async () => "fresh");
    await expect(readOrCreate(lane, ["tasks"], next)).rejects.toThrow("aborted");
    expect(next).not.toHaveBeenCalled();

    // It recovers like any other failed first load.
    lane.invalidate(["tasks"]);
    await expect(readOrCreate(lane, ["tasks"], next)).resolves.toEqual({ revision: expect.any(Number),
      data: "fresh",
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a cancelled first load even if its loader ignores the signal", async () => {
    const lane = createLane();
    const first = deferred<string>();

    const promise = readOrCreate(lane, ["tasks"], () => first.promise);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);
    // The loader never forwarded the signal and runs to completion anyway.
    first.resolve("loaded");

    // Adopting that value would hand the key data it was told not to fetch, and
    // the reader's transition would commit as if nothing had been cancelled.
    await expect(promise).rejects.toThrow("cancelled");
  });

  it("does nothing to a settled read", async () => {
    const lane = createLane();
    subscribe(lane, ["tasks"]);

    const loader = vi.fn(async () => "value");
    await readOrCreate(lane, ["tasks"], loader);

    lane.cancel(["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number),
      data: "value",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscribers", async () => {
    const lane = createLane();
    const listener = vi.fn();
    subscribe(lane, ["tasks"], {}, listener);

    const pending = pendingLoader();
    readOrCreate(lane, ["tasks"], pending.loader);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);

    // Announcing it would make subscribed readers re-read, turning "stop" into
    // "start again".
    expect(listener).not.toHaveBeenCalled();
  });

  it("only touches the key it names", async () => {
    const lane = createLane();
    const other = pendingLoader();

    readOrCreate(lane, ["tasks", "a"], pendingLoader().loader);
    readOrCreate(lane, ["tasks", "b"], other.loader);
    await settlePromiseHandlers();

    lane.cancel(["tasks", "a"]);

    expect(other.signal?.aborted).toBe(false);
  });

  // `set` installs its cache with no AbortController, so this is the case that
  // decides whether "cancelled" can be inferred from the signal or has to be
  // recorded: there is no signal here to read it from.
  it("cancels a pending promise published by set", async () => {
    const lane = createLane();
    subscribe(lane, ["tasks"]);

    await readOrCreate(lane, ["tasks"], async () => "first");

    const published = deferred<string>();
    const promise = lane.set(["tasks"], published.promise);
    await settlePromiseHandlers();

    lane.cancel(["tasks"]);
    published.resolve("second");

    await expect(promise).resolves.toEqual({ revision: expect.any(Number), data: "first" });
  });

  it("ignores a key it has never read", () => {
    const lane = createLane();

    expect(() => {
      lane.cancel(["missing"]);
    }).not.toThrow();
  });
});
