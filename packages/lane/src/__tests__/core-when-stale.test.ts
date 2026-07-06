import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import { deferred, resetVitest, subscribe } from "./test-utils";

afterEach(resetVitest);

// `whenStale` is the read-time freshness behavior: "revalidate" (default) reuses
// the cached promise; "refetch" discards a stale idle value and fetches fresh.
describe("whenStale", () => {
  const refetch = (staleTime: number) =>
    ({ whenStale: "refetch", staleTime }) as const;

  it("'revalidate' (default) reuses a value even once it is stale", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const opts = { staleTime: 1_000 };

    await expect(readOrCreate(lane, ["k"], loader, opts)).resolves.toEqual({ data: "loaded" });

    await vi.advanceTimersByTimeAsync(5_000); // well past staleTime
    await expect(readOrCreate(lane, ["k"], loader, opts)).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("'refetch' reuses while fresh, discards and refetches once stale", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });

    // Within staleTime → reuse.
    await vi.advanceTimersByTimeAsync(999);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    // Past staleTime, idle → discard and fetch fresh (the reader would suspend).
    await vi.advanceTimersByTimeAsync(2);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("'refetch' still shares an in-flight read (same-transition dedupe)", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const d = deferred<string>();
    const loader = vi.fn(() => d.promise);

    // staleTime 0 — but a pending read is always shared, never discarded.
    const p1 = readOrCreate(lane, ["k"], loader, refetch(0));
    const p2 = readOrCreate(lane, ["k"], loader, refetch(0));
    expect(p2).toBe(p1);

    d.resolve("loaded");
    await expect(p1).resolves.toEqual({ data: "loaded" });
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("'refetch' reuses a stale value while a subscriber is attached", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    subscribe(lane, ["k"]);

    await expect(readOrCreate(lane, ["k"], loader, refetch(0))).resolves.toEqual({ data: "loaded" });

    // Stale (staleTime 0), but an active key is never yanked out from under its
    // subscribers — the shared promise is reused.
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(readOrCreate(lane, ["k"], loader, refetch(0))).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("'refetch' always retries a prior error, even within staleTime", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    loader.mockRejectedValueOnce(new Error("boom"));

    // Initial load rejects → the entry holds a rejected, settled cache.
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(10_000)),
    ).rejects.toThrow("boom");
    expect(loader).toHaveBeenCalledTimes(1);

    // Idle remount well within staleTime: a prior error is never reused (errors
    // are not gated by staleTime), so the read refetches fresh.
    await vi.advanceTimersByTimeAsync(1);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(10_000)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
