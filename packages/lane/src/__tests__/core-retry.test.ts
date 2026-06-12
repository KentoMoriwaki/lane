import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import { resetVitest } from "./test-utils";

afterEach(resetVitest);

describe("loader retry", () => {
  it("does not retry by default", async () => {
    const lane = createLane();
    const error = new Error("offline");
    const loader = vi.fn(async () => {
      throw error;
    });

    await expect(readOrCreate(lane, ["tasks"], loader)).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries with the configured delay until the loader succeeds", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockResolvedValueOnce("third");
    const retryDelay = vi.fn(() => 10);

    const promise = readOrCreate(lane, ["tasks"], loader, {
      retry: 2,
      retryDelay,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toBe("third");
    expect(loader).toHaveBeenCalledTimes(3);
    expect(retryDelay).toHaveBeenNthCalledWith(1, 0, expect.any(Error));
    expect(retryDelay).toHaveBeenNthCalledWith(2, 1, expect.any(Error));
  });

  it("rejects with the last error once the retry budget is exhausted", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const last = new Error("last");
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(last);

    const promise = readOrCreate(lane, ["tasks"], loader, {
      retry: 1,
      retryDelay: () => 10,
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).rejects.toBe(last);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("an abort during the retry delay stops further attempts", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const error = new Error("offline");
    const loader = vi.fn(async () => {
      throw error;
    });

    const promise = readOrCreate(lane, ["tasks"], loader, {
      retry: 5,
      retryDelay: () => 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    lane.invalidate(["tasks"]);

    await expect(promise).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
