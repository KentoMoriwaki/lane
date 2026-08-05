import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import type { LaneLoaderContext } from "../types";
import { resetVitest, subscribe } from "./test-utils";

afterEach(resetVitest);

// `context.current` is the entry's last fulfilled value, snapshotted when the
// read is created. It is what lets a loader re-read *as much as it already had*
// (accumulated pages, a resume cursor, a revision) instead of only what the key
// describes.
describe("loader context: current", () => {
  it("is undefined on a first load", async () => {
    const lane = createLane();
    const seen: unknown[] = [];

    await readOrCreate(lane, ["feed"], async ({ current }) => {
      seen.push(current);
      return "page-1";
    });

    expect(seen).toEqual([undefined]);
  });

  it("holds the previous value on an invalidation-driven re-read", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = async ({ current }: LaneLoaderContext) => {
      seen.push(current);
      return current === undefined ? "page-1" : `${current}+page-2`;
    };

    // A live subscriber is what a mounted reader gives the entry.
    subscribe(lane, ["feed"]);

    await readOrCreate(lane, ["feed"], loader);
    lane.invalidate(["feed"]);
    await expect(readOrCreate(lane, ["feed"], loader)).resolves.toEqual({ revision: expect.any(Number),
      data: "page-1+page-2",
    });

    expect(seen).toEqual([undefined, "page-1"]);
  });

  it("survives repeated invalidations while a reader is subscribed", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = async ({ current }: LaneLoaderContext) => {
      seen.push(current);
      return `v${seen.length}`;
    };

    subscribe(lane, ["feed"]);

    await readOrCreate(lane, ["feed"], loader);
    lane.invalidate(["feed"]);
    await readOrCreate(lane, ["feed"], loader);
    lane.invalidate(["feed"]);
    await readOrCreate(lane, ["feed"], loader);

    expect(seen).toEqual([undefined, "v1", "v2"]);
  });

  it("is undefined again after an invalidation nothing was subscribed to", async () => {
    // Pins the documented asymmetry: invalidating clears the cache, and an entry
    // with neither a cache nor a subscriber is dropped entirely — taking
    // `lastFulfilled` with it. A list refreshed while its component is unmounted
    // therefore comes back one page deep, not N.
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = async ({ current }: LaneLoaderContext) => {
      seen.push(current);
      return "page-1";
    };

    await readOrCreate(lane, ["feed"], loader);
    lane.invalidate(["feed"]);
    await readOrCreate(lane, ["feed"], loader);

    expect(seen).toEqual([undefined, undefined]);
  });

  it("is the last fulfilled value, not a failed refresh", async () => {
    const lane = createLane();
    const seen: unknown[] = [];

    subscribe(lane, ["feed"]);

    await readOrCreate(lane, ["feed"], async ({ current }) => {
      seen.push(current);
      return "page-1";
    });

    // Stale-on-error: the read resolves with the previous value plus the error,
    // and `lastFulfilled` is left alone.
    lane.invalidate(["feed"]);
    await expect(
      readOrCreate(lane, ["feed"], async ({ current }) => {
        seen.push(current);
        throw new Error("offline");
      }),
    ).resolves.toEqual({ revision: expect.any(Number), data: "page-1", refreshError: expect.any(Error) });

    lane.invalidate(["feed"]);
    await readOrCreate(lane, ["feed"], async ({ current }) => {
      seen.push(current);
      return "page-2";
    });

    expect(seen).toEqual([undefined, "page-1", "page-1"]);
  });

  it("keeps one snapshot across every retry of the same read", async () => {
    const lane = createLane();
    const seen: unknown[] = [];

    subscribe(lane, ["feed"]);
    await readOrCreate(lane, ["feed"], async () => "page-1");

    lane.invalidate(["feed"]);
    // Publishing a different value mid-read must not change what the read was
    // started from.
    const loader = vi
      .fn(async ({ current }: LaneLoaderContext) => {
        seen.push(current);
        if (seen.length < 3) {
          throw new Error("flaky");
        }
        return "page-2";
      })
      .mockName("loader");

    await readOrCreate(lane, ["feed"], loader, {
      retry: 2,
      retryDelay: () => 0,
    });

    expect(loader).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(["page-1", "page-1", "page-1"]);
  });

  it("sees a value published with set", async () => {
    const lane = createLane();
    const seen: unknown[] = [];

    subscribe(lane, ["feed"]);
    lane.set(["feed"], "seeded");
    lane.invalidate(["feed"]);

    await readOrCreate(lane, ["feed"], async ({ current }) => {
      seen.push(current);
      return "reloaded";
    });

    expect(seen).toEqual(["seeded"]);
  });

  it("is undefined after an unsubscribed entry is removed", async () => {
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = async ({ current }: LaneLoaderContext) => {
      seen.push(current);
      return "page-1";
    };

    await readOrCreate(lane, ["feed"], loader);
    lane.remove(["feed"]);
    await readOrCreate(lane, ["feed"], loader);

    expect(seen).toEqual([undefined, undefined]);
  });

  it("is undefined after a removal a subscribed reader outlives", async () => {
    // `cleanupEntry` keeps an entry that still has a subscriber, so removal
    // cannot rely on dropping the entry to forget its value — `removeLaneEntry`
    // clears `lastFulfilled` itself. Otherwise removing on sign-out while a
    // reader is still mounted would hand the next loader the signed-out value
    // (and leave it as the stale-on-error fallback).
    const lane = createLane();
    const seen: unknown[] = [];
    const loader = async ({ current }: LaneLoaderContext) => {
      seen.push(current);
      return "page-1";
    };

    subscribe(lane, ["feed"]);
    await readOrCreate(lane, ["feed"], loader);

    lane.remove(["feed"]);
    await readOrCreate(lane, ["feed"], loader);

    expect(seen).toEqual([undefined, undefined]);
  });
});
