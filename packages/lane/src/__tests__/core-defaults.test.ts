import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import { toReadOptions } from "../read-options";
import { resetVitest, subscribe } from "./test-utils";

afterEach(resetVitest);

// `createLane({ defaults })` is the app-wide floor under a read's own options.
// The four options the store sees (`retry` / `retryDelay` / `staleTime` /
// `whenStale`) are resolved on the read path, where each is already read with a
// `??`; the three reader-side triggers are resolved at fire time (see
// `read-options.test.ts` and `defaults-react.test.ts`).
describe("lane read-option defaults", () => {
  it("retries from the defaults when the read says nothing", async () => {
    vi.useFakeTimers();

    const lane = createLane({ defaults: { retry: 2, retryDelay: () => 10 } });
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockResolvedValueOnce("third");

    const promise = readOrCreate(lane, ["tasks"], loader);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual({ data: "third" });
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("falls back per option, so a read that sets only retry still gets the default delay", async () => {
    vi.useFakeTimers();

    const retryDelay = vi.fn(() => 25);
    const lane = createLane({ defaults: { retryDelay } });
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("one"))
      .mockResolvedValueOnce("second");

    const promise = readOrCreate(lane, ["tasks"], loader, { retry: 1 });

    await vi.advanceTimersByTimeAsync(25);

    await expect(promise).resolves.toEqual({ data: "second" });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(0, expect.any(Error));
  });

  it("a read opts out of a default by writing the built-in explicitly", async () => {
    const lane = createLane({ defaults: { retry: 3, retryDelay: () => 10 } });
    const error = new Error("offline");
    const loader = vi.fn(async () => {
      throw error;
    });

    // `retry: 0` is a value, not an absence — the read is not retried at all.
    await expect(
      readOrCreate(lane, ["tasks"], loader, { retry: 0 }),
    ).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit `undefined` as unspecified", async () => {
    vi.useFakeTimers();

    const lane = createLane({ defaults: { retry: 1, retryDelay: () => 10 } });
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("one"))
      .mockResolvedValueOnce("second");

    // `toReadOptions` is the shape every hook hands to the read path: an object
    // whose unset options are present and `undefined`. Those have to fall through
    // to the defaults, or a lane-wide default would only ever reach a direct
    // `readOrCreate` call.
    const promise = readOrCreate(lane, ["tasks"], loader, toReadOptions({}));

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual({ data: "second" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("resolves whenStale and staleTime from the defaults", async () => {
    vi.useFakeTimers();

    const lane = createLane({
      defaults: { staleTime: 1_000, whenStale: "refetch" },
    });
    const loader = vi.fn(async () => "loaded");

    // Adopt once so a later idle read is a genuine remount rather than a
    // pre-commit suspense retry (which reuses, to avoid a refetch loop).
    const unsubscribe = subscribe(lane, ["k"]);
    await expect(readOrCreate(lane, ["k"], loader)).resolves.toEqual({
      data: "loaded",
    });
    unsubscribe();

    // Within the defaulted staleTime → reuse.
    await vi.advanceTimersByTimeAsync(999);
    await expect(readOrCreate(lane, ["k"], loader)).resolves.toEqual({
      data: "loaded",
    });
    expect(loader).toHaveBeenCalledTimes(1);

    // Past it, idle remount → the defaulted "refetch" discards and reloads.
    await vi.advanceTimersByTimeAsync(2);
    await expect(readOrCreate(lane, ["k"], loader)).resolves.toEqual({
      data: "loaded",
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("a read's own whenStale overrides a defaulted 'refetch'", async () => {
    vi.useFakeTimers();

    const lane = createLane({
      defaults: { staleTime: 0, whenStale: "refetch" },
    });
    const loader = vi.fn(async () => "loaded");

    const unsubscribe = subscribe(lane, ["k"]);
    await expect(
      readOrCreate(lane, ["k"], loader, { whenStale: "revalidate" }),
    ).resolves.toEqual({ data: "loaded" });
    unsubscribe();

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(
      readOrCreate(lane, ["k"], loader, { whenStale: "revalidate" }),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("a read's own staleTime is judged against, not the defaulted one", async () => {
    vi.useFakeTimers();

    const lane = createLane({
      defaults: { staleTime: 60_000, whenStale: "refetch" },
    });
    const loader = vi.fn(async () => "loaded");
    const read = { staleTime: 1_000 };

    const unsubscribe = subscribe(lane, ["k"]);
    await expect(readOrCreate(lane, ["k"], loader, read)).resolves.toEqual({
      data: "loaded",
    });
    unsubscribe();

    // Stale by the read's 1s, still fresh by the lane's 60s: the read wins.
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(readOrCreate(lane, ["k"], loader, read)).resolves.toEqual({
      data: "loaded",
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("leaves a lane with no defaults on the built-ins", async () => {
    const lane = createLane({ defaults: {} });
    const error = new Error("offline");
    const loader = vi.fn(async () => {
      throw error;
    });

    await expect(readOrCreate(lane, ["tasks"], loader)).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

// A prefetch is not a read, and pins `whenStale` for that reason. The defaults
// must not reintroduce read-time policy through the back door.
describe("prefetch against lane defaults", () => {
  it("keeps deduping when the defaults ask for 'refetch'", async () => {
    vi.useFakeTimers();

    const lane = createLane({
      defaults: { staleTime: 0, whenStale: "refetch" },
    });
    const loader = vi.fn(async () => "warm");

    const unsubscribe = subscribe(lane, ["tasks"]);
    await lane.prefetch({ key: ["tasks"], loader });
    unsubscribe();

    // A re-fired prefetch (repeated link hover) reuses the settled cache: the
    // pinned "revalidate" beats the lane-wide "refetch".
    await vi.advanceTimersByTimeAsync(5_000);
    await lane.prefetch({ key: ["tasks"], loader });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("inherits the defaults' retry", async () => {
    vi.useFakeTimers();

    const lane = createLane({ defaults: { retry: 1, retryDelay: () => 10 } });
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("one"))
      .mockResolvedValueOnce("warm");

    const promise = lane.prefetch({ key: ["tasks"], loader });

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual({ data: "warm" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
