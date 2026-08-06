import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GC_TIME } from "../core";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import type { Lane, LaneLoaderContext } from "../types";
import { resetVitest, subscribe } from "./test-utils";

afterEach(resetVitest);

// gcTime is a retention policy with two homes: the lane's (createLane({ gcTime }))
// is the default, and a read's is what decides how long *its* value outlives the
// reader holding it. One coalesced timer per lane — armed only when an entry
// loses its last subscriber, for the nearest deadline among the idle entries —
// evicts each one when its own time is up. Because it is lane-wide it also
// reclaims orphans (read but never subscribed) opportunistically, so the read
// path itself never arms a timer. Collection is never synchronous: leaving and
// coming back within one task is not leaving.
describe("garbage collection", () => {
  // The only thing that arms the lane sweep is an entry losing its last
  // subscriber. Tests use a throwaway cached key for that, so they can observe
  // collection of other idle/orphan entries on the same lane.
  async function armSweepViaChurn(lane: Lane): Promise<void> {
    await readOrCreate(lane, ["__churn__"], async () => "churn");
    subscribe(lane, ["__churn__"])();
  }

  it("collects an orphaned entry on a later lane-wide sweep", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });
    const loader = vi.fn(async () => "loaded");

    // Orphan: read but never subscribed. The read alone arms no timer.
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ revision: expect.any(Number), data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    // A real unsubscribe elsewhere arms the sweep, which reclaims the orphan too.
    await armSweepViaChurn(lane);
    await vi.advanceTimersByTimeAsync(1_000);

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
