import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import type { Lane } from "../types";
import { resetVitest, settlePromiseHandlers, subscribe } from "./test-utils";

afterEach(resetVitest);

// prefetch warms the cache without subscribing or suspending: it starts the
// load through the same read path a reader would, so a later read of the same
// key adopts the in-flight or settled promise. It arms no GC timer, so an
// unadopted prefetch is an orphan reclaimed by the lane-wide sweep.
describe("prefetch", () => {
  // The lane sweep is armed only by an entry losing its last subscriber.
  async function armSweepViaChurn(lane: Lane): Promise<void> {
    await readOrCreate(lane, ["__churn__"], async () => "churn");
    subscribe(lane, ["__churn__"])();
  }

  it("warms the cache and dedupes a repeat prefetch", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "warm");

    // Re-fired (e.g. hover re-enter): the second call reuses the cache the first
    // created, so the loader runs once.
    lane.prefetch(["tasks"], loader);
    lane.prefetch(["tasks"], loader);
    await settlePromiseHandlers();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("lets a later read adopt the prefetched cache without refetching", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "warm");

    await expect(lane.prefetch(["tasks"], loader)).resolves.toEqual({
      data: "warm",
    });
    expect(loader).toHaveBeenCalledTimes(1);

    // A reader of the same key reuses the warm cache instead of loading again.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({
      data: "warm",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe, so an unadopted prefetch is collected on a later sweep", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "warm");

    // Prefetched but never adopted: an orphan, and like any read it arms no timer.
    await lane.prefetch(["tasks"], loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // A real unsubscribe elsewhere arms the sweep, which reclaims the orphan too.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000);

    // The entry is gone, so the next read fetches again.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({
      data: "warm",
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps a prefetch a subscriber has adopted", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "warm");

    await lane.prefetch(["tasks"], loader);
    const unsubscribe = subscribe(lane, ["tasks"]);

    // Sweeps run (armed by churn), yet the adopted entry survives every cycle.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000 * 5);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({
      data: "warm",
    });
    expect(loader).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("retries a failing prefetch per the options", async () => {
    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce("warm");

    await expect(
      lane.prefetch(["tasks"], loader, { retry: 1, retryDelay: () => 0 }),
    ).resolves.toEqual({ data: "warm" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
