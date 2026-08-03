import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate, subscribeLane } from "./test-utils";
import { createLane } from "../index";
import type { Lane, LaneKey, LaneLoader, LaneRead } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

afterEach(resetVitest);

/**
 * A subscriber that re-reads on every notification, passing the gate straight
 * back to `readOrCreate` — the store-level shape of what `useLane` does. A
 * listener that only counts calls would never make the gated read happen.
 */
function reader<T>(lane: Lane, key: LaneKey, loader: LaneLoader<T>) {
  const state = {
    notifications: 0,
    promise: undefined as Promise<LaneRead<T>> | undefined,
  };

  subscribeLane(lane, key, {
    onInvalidate: (_entry, _source, gate) => {
      state.notifications += 1;
      state.promise = readOrCreate(lane, key, loader, undefined, gate);
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
    // ends. One notification does the whole job — the read it triggers is armed
    // now and fetches later.
    expect(view.notifications).toBe(1);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(view.notifications).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("keeps the gated read pending for the whole action", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");
    const settledEarly = vi.fn();

    lane.set(["tasks"], "cached");
    const view = reader(lane, ["tasks"], loader);

    lane.invalidate(["tasks"], { after: action.promise });
    void view.promise?.then(settledEarly);
    await settlePromiseHandlers();

    // Pending for the whole action: this is what a reader suspends on, so
    // settling early would end the pending window before the data lands.
    expect(settledEarly).not.toHaveBeenCalled();
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

  it("defers a key nobody is reading instead of emptying it", async () => {
    // The reason `invalidateAll` can name a whole family. With no subscriber
    // there is nobody to announce to and nobody to refill the cache the fan-out
    // would empty, so the entry is left intact and converges when the action
    // lands. A reader arriving mid-action sees the last known value — the same
    // as `await action; invalidate(key)` — and is corrected at the end.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    lane.invalidate(["tasks"], { after: action.promise });
    await settlePromiseHandlers();

    const view = reader(lane, ["tasks"], loader);
    await expect(view.promise).resolves.toEqual({ data: "cached" });
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(view.notifications).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("restarts an in-flight first load behind the action", async () => {
    // An entry with no value yet is treated no differently: its read is aborted
    // and re-armed behind the action, so the source is read once — after the
    // mutation — instead of racing it and then being thrown away.
    const lane = createLane();
    const action = deferred<void>();
    const first = deferred<string>();
    const loads = [() => first.promise, async () => "fresh"];
    const loader = vi.fn(() => (loads.shift() ?? (async () => "extra"))());
    const signals: AbortSignal[] = [];
    const tracked = vi.fn((context: { signal: AbortSignal }) => {
      signals.push(context.signal);
      return loader();
    });

    const view = reader(lane, ["tasks"], tracked);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    lane.invalidate(["tasks"], { after: action.promise });
    expect(view.notifications).toBe(1);
    expect(signals[0].aborted).toBe(true);

    // Nothing new goes out while the action runs.
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    action.resolve();
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(2);
    await expect(view.promise).resolves.toEqual({ data: "fresh" });
  });

  it("gates every entry an invalidateAll scope matches", async () => {
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

  it("respects onlyIf when deciding to gate", async () => {
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

  it("keeps a gated entry in flight for staleness policies", async () => {
    // A gated read has no settlement, so a poll that only fires on settled
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
