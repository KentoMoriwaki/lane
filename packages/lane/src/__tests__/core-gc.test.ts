import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GC_TIME, readOrCreate } from "../core";
import { createLane } from "../index";
import type { Lane, LaneLoaderContext } from "../types";
import { resetVitest, subscribeWithOptions } from "./test-utils";

afterEach(resetVitest);

// gcTime is an instance-level retention policy (createLane({ gcTime })). A single
// coalesced sweep per lane — armed only when an entry loses its last subscriber —
// evicts entries idle longer than gcTime. Because the sweep is lane-wide it also
// reclaims orphans (read but never subscribed) opportunistically, so the read
// path itself never arms a timer.
describe("garbage collection", () => {
  // The only thing that arms the lane sweep is an entry losing its last
  // subscriber. Tests use a throwaway cached key for that, so they can observe
  // collection of other idle/orphan entries on the same lane.
  async function armSweepViaChurn(lane: Lane): Promise<void> {
    await readOrCreate(lane, ["__churn__"], async () => "churn");
    subscribeWithOptions(lane, ["__churn__"], {})();
  }

  it("collects an orphaned entry on a later lane-wide sweep", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    // Orphan: read but never subscribed. The read alone arms no timer.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    // A real unsubscribe elsewhere arms the sweep, which reclaims the orphan too.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not collect an entry that still has a subscriber", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {});

    // A sweep is running (armed by churn elsewhere), yet the subscribed entry is
    // skipped every cycle.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000 * 5);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("collects after the last subscriber leaves, honoring the lane gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {});

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });

    unsubscribe();
    await vi.advanceTimersByTimeAsync(999);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a re-attached subscriber prevents collection", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {});

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    unsubscribe();

    await vi.advanceTimersByTimeAsync(500);
    const resubscribed = subscribeWithOptions(lane, ["tasks"], {});
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    resubscribed();
  });

  it("never collects with gcTime Infinity", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: Infinity });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {});

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    unsubscribe();

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME * 10);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending load when its entry is collected", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: LaneLoaderContext) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    // Pending orphan: in-flight, never subscribed.
    readOrCreate(lane, ["tasks"], loader);
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);

    // A real unsubscribe drives the sweep, which reclaims the pending orphan and
    // aborts its loader.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(true);
  });

  it("collects immediately on unsubscribe when gcTime is 0", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 0 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribeWithOptions(lane, ["tasks"], {});

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });

    // gcTime 0 sweeps synchronously when the last subscriber leaves — no timer
    // advance needed. (An armed 0ms interval would instead need a tick and could
    // spin the event loop.)
    unsubscribe();

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
