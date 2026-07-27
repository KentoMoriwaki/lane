import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate, subscribeLane } from "../core";
import { createLane } from "../index";
import type { Lane, LaneKey, LaneLoader, LaneRead } from "../types";
import { deferred, resetVitest, settlePromiseHandlers, subscribe } from "./test-utils";

afterEach(resetVitest);

/**
 * A subscriber that re-reads on every notification — the store-level shape of
 * what `useLane` does. `{ after }` converges in two notifications (announce,
 * then invalidate for real), so a listener that only counts calls would never
 * see the second read happen.
 */
function reader<T>(lane: Lane, key: LaneKey, loader: LaneLoader<T>) {
  const state = {
    notifications: 0,
    promise: undefined as Promise<LaneRead<T>> | undefined,
  };

  subscribeLane(lane, key, {
    onInvalidate: () => {
      state.notifications += 1;
      state.promise = readOrCreate(lane, key, loader);
    },
  });

  state.promise = readOrCreate(lane, key, loader);

  return state;
}

describe("invalidate({ after })", () => {
  it("announces at the start of the action and converges at the end", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    const view = reader(lane, ["tasks"], loader);

    lane.invalidate(["tasks"], { after: action.promise });

    // The whole point: readers hear about it when the action starts, not when it
    // ends — and they keep serving the value they already had.
    expect(view.notifications).toBe(1);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(view.notifications).toBe(2);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("keeps the held promise pending for the whole action", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");
    const settledFirst = vi.fn();

    lane.set(["tasks"], "cached");
    subscribe(lane, ["tasks"]);

    lane.invalidate(["tasks"], { after: action.promise });

    const held = readOrCreate(lane, ["tasks"], loader);
    void held.then(settledFirst);
    await settlePromiseHandlers();

    // Pending, not resolved to the stale value: this is what a reader suspends
    // on, so resolving early would end the pending window before the data lands.
    expect(settledFirst).not.toHaveBeenCalled();
  });

  it("still converges when the action rejects", async () => {
    // `after` chooses when to converge, not whether the key is suspect: a failed
    // action leaves the entry invalidated, so the next read reflects whatever
    // the source actually holds.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    const view = reader(lane, ["tasks"], loader);

    lane.invalidate(["tasks"], { after: action.promise });
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.reject(new Error("save failed"));
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(1);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("does not surface the action's rejection through Lane", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const unhandled = vi.fn();

    process.on("unhandledRejection", unhandled);
    try {
      lane.set(["tasks"], "cached");
      lane.invalidate(["tasks"], { after: action.promise });
      action.reject(new Error("save failed"));

      await settlePromiseHandlers();
      await settlePromiseHandlers();
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });

  it("holds a key nobody is reading, and converges it once a reader arrives", async () => {
    // The reason `invalidateAll` can name a whole family: an unmounted key keeps
    // the held promise as its cache, so it is not collected as empty, and a
    // reader arriving mid-action adopts the pending window instead of fetching
    // straight into the pre-mutation source.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    lane.invalidate(["tasks"], { after: action.promise });
    await settlePromiseHandlers();

    const view = reader(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(1);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("leaves an entry with no value yet to its in-flight read", async () => {
    // Nothing to hold and every reader is already suspended, so there is nothing
    // to announce. The first load is left alone and the scheduled invalidation
    // converges it once the action lands.
    const lane = createLane();
    const action = deferred<void>();
    const first = deferred<string>();
    const loads = [() => first.promise, async () => "fresh"];
    const loader = vi.fn(() => (loads.shift() ?? (async () => "extra"))());

    const view = reader(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    lane.invalidate(["tasks"], { after: action.promise });
    expect(view.notifications).toBe(0); // nothing worth announcing

    // The in-flight first load is untouched.
    first.resolve("initial");
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    action.resolve();
    await settlePromiseHandlers();

    expect(view.notifications).toBe(1);
    expect(loader).toHaveBeenCalledTimes(2);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("holds every entry an invalidateAll scope matches", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const list = vi.fn(async () => "list");
    const detail = vi.fn(async () => "detail");
    const unrelated = vi.fn(async () => "unrelated");

    lane.set(["tasks"], "cached-list");
    lane.set(["tasks", 1], "cached-detail");
    lane.set(["users"], "cached-users");

    const listView = reader(lane, ["tasks"], list);
    const detailView = reader(lane, ["tasks", 1], detail);

    lane.invalidateAll(["tasks"], { after: action.promise });
    await settlePromiseHandlers();

    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
    // Out of scope: untouched, so it still serves its cached value.
    await expect(readOrCreate(lane, ["users"], unrelated)).resolves.toEqual({
      data: "cached-users",
    });
    expect(unrelated).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(list).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledTimes(1);
    await expect(Promise.all([listView.promise, detailView.promise])).resolves.toEqual([
      { data: "list" },
      { data: "detail" },
    ]);
  });

  it("respects onlyIf when deciding to hold", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const inflight = deferred<string>();
    const loader = vi.fn(() => inflight.promise);

    readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    // The read is in flight, so `onlyIf: "settled"` skips the entry — no hold and
    // no deferred invalidation.
    lane.invalidate(["tasks"], { after: action.promise, onlyIf: "settled" });

    inflight.resolve("first");
    action.resolve();
    await settlePromiseHandlers();

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({
      data: "first",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps a held entry in flight for staleness policies", async () => {
    // The held promise has no settlement, so a poll that only fires on settled
    // entries steps around it instead of cutting the pending window short.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    const view = reader(lane, ["tasks"], loader);

    lane.invalidate(["tasks"], { after: action.promise });
    expect(view.notifications).toBe(1);

    lane.invalidate(["tasks"], { background: true, onlyIf: "settled" });
    expect(view.notifications).toBe(1);

    action.resolve();
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
