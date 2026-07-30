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

    // Adopt once so later idle reads are genuine remounts. Without a prior
    // subscription an idle read is a pre-commit suspense retry, which reuses to
    // avoid a refetch loop (see the "never adopted" case below).
    const unsubscribe = subscribe(lane, ["k"]);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });
    unsubscribe();

    // Within staleTime → reuse.
    await vi.advanceTimersByTimeAsync(999);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);

    // Past staleTime, idle remount → discard and fetch fresh (reader suspends).
    await vi.advanceTimersByTimeAsync(2);
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(1_000)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("'refetch' reuses a stale value that has never been adopted (no refetch loop)", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    // A never-subscribed entry (a pre-commit suspense retry, or a prefetch/
    // hydration read a reader is adopting for the first time) is not a remount.
    // Re-reading a stale value must reuse it, never discard-and-refetch — the
    // latter loops forever because each retry re-settles and re-judges it stale.
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(0)),
    ).resolves.toEqual({ data: "loaded" });

    await vi.advanceTimersByTimeAsync(5_000); // well past staleTime
    await expect(
      readOrCreate(lane, ["k"], loader, refetch(0)),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
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

  it("'revalidate' (default) reuses a prior error rather than retrying it", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    loader.mockRejectedValueOnce(new Error("boom"));

    await expect(readOrCreate(lane, ["k"], loader)).rejects.toThrow("boom");
    expect(loader).toHaveBeenCalledTimes(1);

    // A fresh read of the key — a remount, an Error Boundary reset — is handed
    // the same rejected promise, not a new load. Only `refetch` (or an
    // invalidate/remove) discards it.
    await expect(readOrCreate(lane, ["k"], loader)).rejects.toThrow("boom");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("'refetch' does not loop on the retries that follow a remount refetch", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    // Mount, commit, subscribe.
    const unsubscribe = subscribe(lane, ["k"]);
    await readOrCreate(lane, ["k"], loader, refetch(0));
    expect(loader).toHaveBeenCalledTimes(1);

    // Leave the key: idle, but the value is kept.
    unsubscribe();

    // Come back — a genuine idle remount, so the stale value is discarded.
    await readOrCreate(lane, ["k"], loader, refetch(0));
    expect(loader).toHaveBeenCalledTimes(2);

    // React retries the render that has not committed yet. The value it now
    // judges is the one *this* remount just produced, and nothing has committed
    // on it, so re-reading must not discard it again — otherwise every retry
    // refetches and the read never settles into a commit.
    await readOrCreate(lane, ["k"], loader, refetch(0));
    await readOrCreate(lane, ["k"], loader, refetch(0));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("'refetch' with no staleTime never discards, since nothing is stale", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const loader = vi.fn(async () => "loaded");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // No `staleTime`, so the default (Infinity) applies and "refetch" has nothing
    // to act on — the read behaves exactly like the default "revalidate". The
    // option was accepted and then did nothing, which is what the warning is for.
    await readOrCreate(lane, ["k"], loader, { whenStale: "refetch" });
    subscribe(lane, ["k"])();

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(
      readOrCreate(lane, ["k"], loader, { whenStale: "refetch" }),
    ).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
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
