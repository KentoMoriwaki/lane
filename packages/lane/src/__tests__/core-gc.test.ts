import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GC_TIME, readOrCreate } from "../core";
import { createLane } from "../index";
import type { LaneLoaderContext } from "../types";
import { resetVitest, subscribeWithOptions } from "./test-utils";

afterEach(resetVitest);

describe("garbage collection", () => {
  it("collects unobserved entries after the default gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not collect entries while a subscriber is attached", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    subscribeWithOptions(lane, ["tasks"], {});

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME * 2);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("collects after the last subscriber leaves, honoring the subscriber gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {
      gcTime: 1_000,
    });

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );

    unsubscribe();
    await vi.advanceTimersByTimeAsync(999);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a re-attached subscriber cancels a pending collection", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {
      gcTime: 1_000,
    });

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    unsubscribe();

    await vi.advanceTimersByTimeAsync(999);
    const resubscribed = subscribeWithOptions(lane, ["tasks"], {
      gcTime: 1_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(1);

    resubscribed();
  });

  it("never collects entries with gcTime Infinity", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {
      gcTime: Infinity,
    });

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    unsubscribe();

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME * 10);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "loaded",
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending load when collecting an unobserved entry", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: LaneLoaderContext) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    readOrCreate(lane, ["tasks"], loader);
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME);

    expect(signal?.aborted).toBe(true);
    readOrCreate(lane, ["tasks"], loader);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
