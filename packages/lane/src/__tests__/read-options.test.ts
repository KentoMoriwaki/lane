import { afterEach, describe, expect, it, vi } from "vitest";
import { revalidateOptions } from "../read-options";

// `revalidateOptions` is the single mapping every revalidation trigger
// (`refetchOnMount` / `refetchOnFocus` / `refetchOnReconnect`) shares to turn its
// value into the conditional invalidation a reader fires.
describe("revalidateOptions", () => {
  it("returns undefined when the trigger is off", () => {
    expect(revalidateOptions(false, 1_000)).toBeUndefined();
    expect(revalidateOptions(undefined, 1_000)).toBeUndefined();
  });

  it("maps `true` to a stale-only invalidation carrying the staleTime", () => {
    expect(revalidateOptions(true, 1_000)).toEqual({
      onlyIf: "stale",
      staleTime: 1_000,
    });
    expect(revalidateOptions(true, undefined)).toEqual({
      onlyIf: "stale",
      staleTime: undefined,
    });
  });

  // A trigger has one meaning: refresh what is stale. The unconditional form is
  // deliberately absent — `staleTime: 0` says the same thing, and
  // `lane.invalidate(key, { onlyIf: "settled" })` is where an app goes to refresh
  // regardless of freshness on its own schedule.
  it("has no form that ignores staleTime", () => {
    expect(revalidateOptions(true, 0)).toEqual({
      onlyIf: "stale",
      staleTime: 0,
    });
  });
});

// `staleTime` defaults to Infinity, so `true` with no `staleTime` produces an
// invalidation that can never match. That is silence rather than waste, which is
// the failure mode a warning is for.
describe("revalidateOptions warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The "warn once" bookkeeping is module state, so each test loads a fresh copy
  // instead of depending on the order the previous ones ran in.
  const freshRevalidateOptions = async () => {
    vi.resetModules();

    return (await import("../read-options")).revalidateOptions;
  };

  it("warns for `true` with no staleTime", async () => {
    const revalidate = await freshRevalidateOptions();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    revalidate(true, undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("never fires");
  });

  it("warns once, not on every fire", async () => {
    const revalidate = await freshRevalidateOptions();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A trigger fires on every mount / focus / reconnect, so a warning per call
    // would bury the console it is trying to reach.
    revalidate(true, undefined);
    revalidate(true, undefined);
    revalidate(true, undefined);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a stated staleTime, and for a trigger that is off", async () => {
    const revalidate = await freshRevalidateOptions();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    revalidate(true, 0);
    revalidate(true, 60_000);
    revalidate(false, undefined);
    revalidate(undefined, undefined);

    expect(warn).not.toHaveBeenCalled();
  });
});
