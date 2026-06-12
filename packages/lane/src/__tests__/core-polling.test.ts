import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import { deferred, resetVitest, subscribeWithOptions } from "./test-utils";

afterEach(resetVitest);

describe("refetchInterval polling", () => {
  it("invalidates settled entries on each interval", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "reloaded");
    const listener = vi.fn(() => {
      readOrCreate(lane, ["tasks"], loader);
    });

    lane.set(["tasks"], "cached");
    subscribeWithOptions(lane, ["tasks"], { refetchInterval: 1_000 }, listener);

    await vi.advanceTimersByTimeAsync(999);
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.anything(), "background");
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while a reload is pending", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const reload = deferred<string>();
    const loader = vi.fn(() => reload.promise);
    const listener = vi.fn(() => {
      readOrCreate(lane, ["tasks"], loader);
    });

    lane.set(["tasks"], "cached");
    subscribeWithOptions(lane, ["tasks"], { refetchInterval: 1_000 }, listener);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);

    reload.resolve("reloaded");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uses the smallest interval across subscribers and recomputes on unsubscribe", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const slowListener = vi.fn();
    const fastListener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeWithOptions(
      lane,
      ["tasks"],
      { refetchInterval: 3_000 },
      slowListener,
    );
    const unsubscribeFast = subscribeWithOptions(
      lane,
      ["tasks"],
      { refetchInterval: 1_000 },
      fastListener,
    );

    lane.set(["tasks"], "cached-again");
    slowListener.mockClear();
    fastListener.mockClear();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(slowListener).toHaveBeenCalledTimes(1);
    expect(fastListener).toHaveBeenCalledTimes(1);

    lane.set(["tasks"], "settled");
    slowListener.mockClear();
    fastListener.mockClear();
    unsubscribeFast();

    await vi.advanceTimersByTimeAsync(2_999);
    expect(slowListener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(slowListener).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the last subscriber leaves", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    const unsubscribe = subscribeWithOptions(
      lane,
      ["tasks"],
      { refetchInterval: 1_000 },
      listener,
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(1);

    lane.set(["tasks"], "settled");
    listener.mockClear();
    unsubscribe();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribers without refetchInterval do not start polling", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeWithOptions(lane, ["tasks"], { staleTime: 0 }, listener);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).not.toHaveBeenCalled();
  });
});
