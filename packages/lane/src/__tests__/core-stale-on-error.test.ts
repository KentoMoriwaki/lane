import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import { resetVitest, subscribeInvalidate } from "./test-utils";

afterEach(resetVitest);

// Stale-on-error now carries the failure in the resolved value itself
// (`{ data, refreshError }`) rather than a separate readable channel.
describe("stale-on-error", () => {
  it("serves the last fulfilled value when a reload rejects and exposes the error", async () => {
    const lane = createLane();
    const error = new Error("offline");

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    lane.invalidate(["tasks"]);
    const reloaded = readOrCreate(lane, ["tasks"], async () => {
      throw error;
    });

    await expect(reloaded).resolves.toEqual({ data: "cached", refreshError: error });
  });

  it("keeps initial load rejections as a rejected cache", async () => {
    const lane = createLane();
    const error = new Error("offline");

    const first = readOrCreate(lane, ["tasks"], async () => {
      throw error;
    });

    await expect(first).rejects.toBe(error);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "later"),
    ).rejects.toBe(error);
  });

  it("preserves the original freshness time when falling back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], listener);

    vi.setSystemTime(5_000);
    lane.invalidate(["tasks"]);
    listener.mockClear();

    const reloaded = readOrCreate(lane, ["tasks"], async () => {
      throw new Error("offline");
    });
    await expect(reloaded).resolves.toEqual({
      data: "cached",
      refreshError: expect.any(Error),
    });

    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 10_000 });
    expect(listener).not.toHaveBeenCalled();

    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 4_000 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears the refresh error after a successful reload", async () => {
    const lane = createLane();

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    lane.invalidate(["tasks"]);
    await expect(
      readOrCreate(lane, ["tasks"], async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual({ data: "cached", refreshError: expect.any(Error) });

    lane.invalidate(["tasks"]);
    // A successful reload resolves to data with no refreshError key.
    await expect(
      readOrCreate(lane, ["tasks"], async () => "fresh"),
    ).resolves.toEqual({ data: "fresh" });
  });

  it("falls back for values published through set as rejecting promises", async () => {
    const lane = createLane();
    const error = new Error("offline");
    const rejecting = Promise.reject(error);
    rejecting.catch(() => undefined);

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    const published = lane.set(["tasks"], rejecting);

    await expect(published).resolves.toEqual({ data: "cached", refreshError: error });
  });
});
