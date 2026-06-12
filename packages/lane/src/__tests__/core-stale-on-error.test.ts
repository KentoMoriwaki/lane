import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate, readRefreshError } from "../core";
import { createLane } from "../index";
import { serializeKey } from "../keys";
import {
  resetVitest,
  settlePromiseHandlers,
  subscribeInvalidate,
} from "./test-utils";

afterEach(resetVitest);

const TASKS_ID = serializeKey(["tasks"]);

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

    await expect(reloaded).resolves.toBe("cached");
    expect(readRefreshError(lane, TASKS_ID)).toBe(error);
  });

  it("keeps initial load rejections as a rejected cache", async () => {
    const lane = createLane();
    const error = new Error("offline");

    const first = readOrCreate(lane, ["tasks"], async () => {
      throw error;
    });

    await expect(first).rejects.toBe(error);
    expect(readRefreshError(lane, TASKS_ID)).toBeUndefined();
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
    await expect(reloaded).resolves.toBe("cached");

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
    ).resolves.toBe("cached");
    expect(readRefreshError(lane, TASKS_ID)).toBeInstanceOf(Error);

    lane.invalidate(["tasks"]);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "fresh"),
    ).resolves.toBe("fresh");
    expect(readRefreshError(lane, TASKS_ID)).toBeUndefined();
  });

  it("falls back for values published through set as rejecting promises", async () => {
    const lane = createLane();
    const error = new Error("offline");
    const rejecting = Promise.reject(error);
    rejecting.catch(() => undefined);

    lane.set(["tasks"], "cached");
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    const published = lane.set(["tasks"], rejecting);

    await expect(published).resolves.toBe("cached");
    await settlePromiseHandlers();
    expect(readRefreshError(lane, TASKS_ID)).toBe(error);
  });
});
