import { describe, expect, it } from "vitest";
import { revalidateOptions, triggerOptions } from "../read-options";

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

  it('maps `"always"` to a settled-only invalidation, ignoring staleTime', () => {
    expect(revalidateOptions("always", 60_000)).toEqual({ onlyIf: "settled" });
    expect(revalidateOptions("always", undefined)).toEqual({
      onlyIf: "settled",
    });
  });
});

// `triggerOptions` is the fire-time resolution: the same mapping, with the lane's
// defaults under the read's own options. It exists because the three revalidation
// triggers never reach the store, so the read path cannot resolve them.
describe("triggerOptions", () => {
  it("takes the trigger from the defaults when the read says nothing", () => {
    expect(
      triggerOptions({ refetchOnFocus: true, staleTime: 5_000 }, {}, "refetchOnFocus"),
    ).toEqual({ onlyIf: "stale", staleTime: 5_000 });
  });

  it("prefers the read's own trigger, including a `false` opt-out", () => {
    expect(
      triggerOptions(
        { refetchOnMount: true },
        { refetchOnMount: "always" },
        "refetchOnMount",
      ),
    ).toEqual({ onlyIf: "settled" });

    expect(
      triggerOptions(
        { refetchOnMount: true },
        { refetchOnMount: false },
        "refetchOnMount",
      ),
    ).toBeUndefined();
  });

  it("falls back on the trigger and staleTime independently", () => {
    // Only the trigger is the read's: the staleTime it is judged against still
    // comes from the lane.
    expect(
      triggerOptions(
        { staleTime: 30_000 },
        { refetchOnReconnect: true },
        "refetchOnReconnect",
      ),
    ).toEqual({ onlyIf: "stale", staleTime: 30_000 });

    // And the reverse: the read's staleTime beats the defaulted one.
    expect(
      triggerOptions(
        { refetchOnReconnect: true, staleTime: 30_000 },
        { staleTime: 1_000 },
        "refetchOnReconnect",
      ),
    ).toEqual({ onlyIf: "stale", staleTime: 1_000 });
  });

  it("stays off when neither side turns the trigger on", () => {
    expect(triggerOptions(undefined, {}, "refetchOnFocus")).toBeUndefined();
    expect(
      triggerOptions({ staleTime: 5_000 }, { staleTime: 1_000 }, "refetchOnFocus"),
    ).toBeUndefined();
  });
});
