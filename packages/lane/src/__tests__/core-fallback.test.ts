import { afterEach, describe, expect, it, vi } from "vitest";
import { createLane } from "../index";
import {
  readOrCreate,
  resetVitest,
  subscribeInvalidate,
} from "./test-utils";

afterEach(resetVitest);

// A read's `fallback` is the policy that decides whether a failed load has an
// answer. It replaces the built-in one (serve `lastFulfilled`, else reject)
// rather than extending it, which is why it runs on every failure and is handed
// the same two facts the default decides from.
describe("fallback", () => {
  it("serves its value instead of rejecting when nothing has ever loaded", async () => {
    const lane = createLane();
    const error = new Error("offline");

    const read = readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw error;
      },
      { fallback: () => "empty" },
    );

    await expect(read).resolves.toEqual({
      revision: expect.any(Number),
      data: "empty",
      error,
    });
  });

  it("runs over a last fulfilled value too, and is handed it", async () => {
    const lane = createLane();
    const fallback = vi.fn(({ lastFulfilled }) => lastFulfilled ?? "empty");

    lane.set(["quota"], "cached");
    subscribeInvalidate(lane, ["quota"], vi.fn());
    lane.invalidate(["quota"]);

    await expect(
      readOrCreate(
        lane,
        ["quota"],
        async () => {
          throw new Error("offline");
        },
        { fallback },
      ),
    ).resolves.toMatchObject({ data: "cached" });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0]).toMatchObject({
      key: ["quota"],
      lastFulfilled: "cached",
    });
  });

  it("can decline the last fulfilled value, which the built-in policy cannot", async () => {
    const lane = createLane();

    lane.set(["balance"], 100);
    subscribeInvalidate(lane, ["balance"], vi.fn());
    lane.invalidate(["balance"]);

    // "Showing a stale balance is worse than showing none" — expressible only
    // because the policy runs even when there is something to serve.
    await expect(
      readOrCreate(
        lane,
        ["balance"],
        async () => {
          throw new Error("offline");
        },
        {
          fallback: ({ error }) => {
            throw error;
          },
        },
      ),
    ).rejects.toMatchObject({ name: "LaneReadError", key: ["balance"] });
  });

  it("does not store what it returns, so the next loader still sees no previous value", async () => {
    const lane = createLane();
    const seen: unknown[] = [];

    await expect(
      readOrCreate(
        lane,
        ["quota"],
        async () => {
          throw new Error("offline");
        },
        { fallback: () => "empty" },
      ),
    ).resolves.toMatchObject({ data: "empty" });

    subscribeInvalidate(lane, ["quota"], vi.fn());
    lane.invalidate(["quota"]);

    await readOrCreate(lane, ["quota"], async ({ current }) => {
      seen.push(current);
      return "loaded";
    });

    // `undefined`, not "empty": the entry has still never fulfilled.
    expect(seen).toEqual([undefined]);
  });

  it("keeps the entry's revision when it hands back what it was given", async () => {
    const lane = createLane();

    const loaded = await readOrCreate(lane, ["quota"], async () => "real");
    subscribeInvalidate(lane, ["quota"], vi.fn());
    lane.invalidate(["quota"]);

    const fell = await readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw new Error("offline");
      },
      { fallback: ({ lastFulfilled }) => lastFulfilled ?? "empty" },
    );

    // Same content, so the same number: whatever keys on this revision must not
    // re-derive because a refresh failed over data that did not change.
    expect(fell.data).toBe("real");
    expect(fell.revision).toBe(loaded.revision);
  });

  it("gives a substitute a revision of its own, never the entry's", async () => {
    const lane = createLane();

    const loaded = await readOrCreate(lane, ["quota"], async () => "real");
    subscribeInvalidate(lane, ["quota"], vi.fn());
    lane.invalidate(["quota"]);

    const fell = await readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw new Error("offline");
      },
      { fallback: () => "empty" },
    );

    // The entry never held "empty", so it cannot lend its number to it — one
    // revision must never name two different values.
    expect(fell.data).toBe("empty");
    expect(fell.revision).not.toBe(loaded.revision);

    // And the entry itself did not move: the next loader still sees the real
    // value as `current`.
    const seen: unknown[] = [];
    lane.invalidate(["quota"]);
    await readOrCreate(lane, ["quota"], async ({ current }) => {
      seen.push(current);
      return "real again";
    });
    expect(seen).toEqual(["real"]);
  });

  it("leaves the entry stale, so a freshness-gated refresh still fires", async () => {
    vi.useFakeTimers();
    // The epoch stand-in below is only "as old as possible" once meaningful
    // elapsed time has passed; a monotonic clock intentionally starts at 0.
    vi.advanceTimersByTime(60_001);

    const lane = createLane();
    const listener = vi.fn();

    await readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw new Error("offline");
      },
      { fallback: () => "empty" },
    );

    subscribeInvalidate(lane, ["quota"], listener);
    listener.mockClear();

    // A value that had really just loaded would be fresh for the next minute.
    lane.invalidate(["quota"], { onlyIf: "stale", staleTime: 60_000 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is not selected by onlyIf: "rejected", because it is serving something', async () => {
    const lane = createLane();
    const retried = vi.fn(async () => "recovered");

    await expect(
      readOrCreate(
        lane,
        ["quota"],
        async () => {
          throw new Error("offline");
        },
        { fallback: () => "empty" },
      ),
    ).resolves.toMatchObject({ data: "empty" });

    lane.invalidateAll(() => true, { onlyIf: "rejected" });

    // Still the cached fallback settlement — "retry what is broken" cannot
    // disturb a key that has something on screen.
    await expect(
      readOrCreate(lane, ["quota"], retried, { fallback: () => "empty" }),
    ).resolves.toMatchObject({ data: "empty" });
    expect(retried).not.toHaveBeenCalled();
  });

  it("is not consulted for a cancel, which reverts silently", async () => {
    const lane = createLane();
    const fallback = vi.fn(() => "empty");

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], vi.fn());
    lane.invalidate(["tasks"]);

    // Cancelling aborts the signal; a real loader rejects from it, which is what
    // brings the read to `settleWithoutValue` with the cancel already recorded.
    const read = readOrCreate(
      lane,
      ["tasks"],
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          // The loader runs a microtask after the read is created, so the abort
          // has already landed by the time it looks — as it would for any loader
          // cancelled this promptly.
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }

          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      { fallback },
    );
    lane.cancel(["tasks"]);

    // The caller asked for the stop, so there is no failure to interpret: the
    // previous value comes back with nothing beside it.
    await expect(read).resolves.toEqual({
      revision: expect.any(Number),
      data: "cached",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("belongs to the read that started the load, not to a later adopter", async () => {
    const lane = createLane();
    const adopters = vi.fn(() => "adopter's");

    const started = readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw new Error("offline");
      },
      { fallback: () => "starter's" },
    );
    const adopted = readOrCreate(
      lane,
      ["quota"],
      async () => {
        throw new Error("offline");
      },
      { fallback: adopters },
    );

    // One load, one settlement — and the policy that interprets its failure is
    // the one carried by the read whose loader produced it.
    await expect(started).resolves.toMatchObject({ data: "starter's" });
    await expect(adopted).resolves.toMatchObject({ data: "starter's" });
    expect(adopters).not.toHaveBeenCalled();
  });
});
