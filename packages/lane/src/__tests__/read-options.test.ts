import { describe, expect, it } from "vitest";
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

  it('maps `"always"` to a settled-only invalidation, ignoring staleTime', () => {
    expect(revalidateOptions("always", 60_000)).toEqual({ onlyIf: "settled" });
    expect(revalidateOptions("always", undefined)).toEqual({
      onlyIf: "settled",
    });
  });
});
