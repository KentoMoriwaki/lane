import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
  subscribeInvalidate,
} from "./test-utils";

afterEach(resetVitest);

describe("invalidate({ after })", () => {
  it("notifies immediately and holds the re-read until the action settles", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], listener);

    lane.invalidate(["tasks"], { after: action.promise });

    // The whole point: subscribers hear about it at the start of the action, not
    // at the end.
    expect(listener).toHaveBeenCalledTimes(1);

    const read = readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(1);
    await expect(read).resolves.toEqual({ data: "fresh" });
  });

  it("still runs the read when the action rejects", async () => {
    // `after` chooses when to converge, not whether the key is suspect: a failed
    // action leaves the entry invalidated, so the next read reflects whatever
    // the source actually holds.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    lane.invalidate(["tasks"], { after: action.promise });

    const read = readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.reject(new Error("save failed"));
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(1);
    await expect(read).resolves.toEqual({ data: "fresh" });
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

  it("holds a reader that arrives after the invalidation", async () => {
    // The entry has no cache and no subscribers between the invalidation and the
    // reader, so it must survive on the strength of its gate alone — otherwise a
    // fresh entry would be created and fetch straight into the pre-mutation
    // source.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    lane.invalidate(["tasks"], { after: action.promise });
    await settlePromiseHandlers();

    readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("releases the gate once the action settles", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    lane.invalidate(["tasks"], { after: action.promise });
    action.resolve();
    await settlePromiseHandlers();

    // A later invalidation carries no `after`, so its read is not held back.
    lane.invalidate(["tasks"]);
    readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);
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

    lane.invalidateAll(["tasks"], { after: action.promise });

    const reads = [
      readOrCreate(lane, ["tasks"], list),
      readOrCreate(lane, ["tasks", 1], detail),
    ];
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
    await expect(Promise.all(reads)).resolves.toEqual([
      { data: "list" },
      { data: "detail" },
    ]);
  });

  it("respects onlyIf when arming the gate", async () => {
    const lane = createLane();
    const action = deferred<void>();
    const inflight = deferred<string>();
    const loader = vi.fn(() => inflight.promise);

    readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);

    // The read is in flight, so `onlyIf: "settled"` skips the entry — no
    // invalidation and therefore no gate.
    lane.invalidate(["tasks"], { after: action.promise, onlyIf: "settled" });

    inflight.resolve("first");
    await settlePromiseHandlers();

    // Unchanged and ungated: the cached value is reused without a new fetch.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({
      data: "first",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("leaves a gated entry in flight for staleness policies", async () => {
    // A gated read has no settlement, so a poll that only fires on settled
    // entries steps around it instead of stomping the pending window.
    const lane = createLane();
    const action = deferred<void>();
    const loader = vi.fn(async () => "fresh");
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribe(lane, ["tasks"], listener);

    lane.invalidate(["tasks"], { after: action.promise });
    readOrCreate(lane, ["tasks"], loader);
    listener.mockClear();

    lane.invalidate(["tasks"], { background: true, onlyIf: "settled" });
    expect(listener).not.toHaveBeenCalled();

    action.resolve();
    await settlePromiseHandlers();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
