import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GC_TIME } from "../core";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import type { Lane, LaneLoaderContext } from "../types";
import { resetVitest, subscribe } from "./test-utils";

afterEach(resetVitest);

// Two clocks, and the difference between them is who the entry is being kept
// for. `gcTime` runs from the last unsubscribe: somebody had this and left, and
// it is kept in case they come back. `warmTime` runs from the settlement of an
// entry nobody has held: a prefetch, or a render that suspended and unmounted,
// where the value was loaded for a reader who may still be coming. Both have a
// lane-level default and a per-read override.
//
// One coalesced timer per lane does the collecting, armed for the nearest
// deadline among the entries that have one. In-flight reads have none — a load
// still running is the evidence that somebody may still be waiting on it.
// Collection is never synchronous: leaving and coming back within one task is
// not leaving.
describe("garbage collection", () => {
  // The only thing that arms the lane sweep is an entry losing its last
  // subscriber. Tests use a throwaway cached key for that, so they can observe
  // collection of other idle/orphan entries on the same lane.
  async function armSweepViaChurn(lane: Lane): Promise<void> {
    await readOrCreate(lane, ["__churn__"], async () => "churn");
    subscribe(lane, ["__churn__"])();
  }

  it("collects an entry nobody claimed, on its warmTime", async () => {
    vi.useFakeTimers();

    // Long enough that the departure clock cannot be what collects this.
    const lane = createLane({ gcTime: 60_000, warmTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    // Read, never subscribed: a render that suspended and went away, or a
    // prefetch nobody took. The wait for its first reader starts when it lands.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not collect an entry that still has a subscriber", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    const unsubscribe = subscribe(lane, ["tasks"]);

    // A sweep is running (armed by churn elsewhere), yet the subscribed entry is
    // skipped every cycle.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000 * 5);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("collects after the last subscriber leaves, honoring the lane gcTime", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribe(lane, ["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });

    unsubscribe();
    await vi.advanceTimersByTimeAsync(999);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a re-attached subscriber prevents collection", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribe(lane, ["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    unsubscribe();

    await vi.advanceTimersByTimeAsync(500);
    const resubscribed = subscribe(lane, ["tasks"]);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    resubscribed();
  });

  it("never collects with gcTime Infinity", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: Infinity });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribe(lane, ["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    unsubscribe();

    await vi.advanceTimersByTimeAsync(DEFAULT_GC_TIME * 10);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending load when the reader that had it leaves and its gcTime is up", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: LaneLoaderContext) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    const unsubscribe = subscribe(lane, ["tasks"]);
    readOrCreate(lane, ["tasks"], loader);
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);

    // A departure, so the load is nobody's: collecting it stops it.
    unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(true);
  });

  // The other half, and the reason the pre-arrival clock starts at the
  // settlement: an entry nobody holds is not evidence that nobody is coming, and
  // a load still running is evidence that somebody might be. A suspended render
  // is exactly that, and collecting its entry would abort the read it is waiting
  // on.
  it("never collects an entry whose read is still in flight", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 0, warmTime: 0 });
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: LaneLoaderContext) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    const pending = readOrCreate(lane, ["tasks"], loader);

    // Every sweep the lane can be made to run, with the shortest deadlines it
    // can be given.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signal?.aborted).toBe(false);
    // Still the entry's own read: the reader suspended on it would be handed
    // this same promise when it re-reads.
    expect(readOrCreate(lane, ["tasks"], loader)).toBe(pending);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("collects on the next task, not inside the unsubscribe, when gcTime is 0", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 0 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribe(lane, ["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });

    // `0` is a deadline of "now", not a collection inside this call: the entry
    // is still there for anything else happening in this same task.
    unsubscribe();
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  // Why the collection above cannot be synchronous. React runs StrictMode's
  // double invoke — subscribe, cleanup, subscribe — inside one commit, and tears
  // down and re-creates layout effects around a re-suspension; a store that
  // collected inside the unsubscribe would drop the entry between the two halves
  // of a reader that never went anywhere. Leaving and coming back in the same
  // task is not leaving.
  it("collects nothing when an unsubscribe and a resubscribe share a task", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 0 });
    const loader = vi.fn(async () => "loaded");
    const first = subscribe(lane, ["tasks"]);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });

    first();
    const second = subscribe(lane, ["tasks"]);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    second();
  });

  // The read option: how long *this* read's value outlives the reader holding
  // it, over the lane's policy.
  it("takes the departing reader's gcTime over the lane's", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 60_000 });
    const loader = vi.fn(async () => "loaded");
    const unsubscribe = subscribe(lane, ["tasks"], { gcTime: () => 1_000 });

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });

    unsubscribe();
    await vi.advanceTimersByTimeAsync(999);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  // Two keys, two deadlines, one lane: the short one cannot be held hostage by
  // the long one, which a fixed sweep interval would have done.
  it("collects each entry on its own deadline", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 60_000 });
    const loader = vi.fn(async () => "loaded");

    const longLived = subscribe(lane, ["long"], { gcTime: () => 60_000 });
    const shortLived = subscribe(lane, ["short"], { gcTime: () => 100 });

    await readOrCreate(lane, ["long"], loader);
    await readOrCreate(lane, ["short"], loader);
    expect(loader).toHaveBeenCalledTimes(2);

    longLived();
    shortLived();

    await vi.advanceTimersByTimeAsync(200);

    await readOrCreate(lane, ["short"], loader);
    expect(loader).toHaveBeenCalledTimes(3);

    await readOrCreate(lane, ["long"], loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});
