import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import type { LaneLoaderContext } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

afterEach(resetVitest);

function pendingLoader() {
  let signal: AbortSignal | undefined;
  const loader = vi.fn((context: LaneLoaderContext) => {
    signal = context.signal;
    return new Promise<string>(() => {});
  });

  return {
    loader,
    get signal() {
      return signal;
    },
  };
}

describe("loader abort", () => {
  it("passes the key and a live signal to the loader", async () => {
    const lane = createLane();
    let observed: LaneLoaderContext | undefined;
    const loader = vi.fn((context: LaneLoaderContext) => {
      observed = context;
      return new Promise<string>(() => {});
    });

    readOrCreate(lane, ["tasks", { status: "todo" }], loader);
    await settlePromiseHandlers();

    expect(observed?.key).toEqual(["tasks", { status: "todo" }]);
    expect(observed?.signal.aborted).toBe(false);
  });

  it("aborts the in-flight loader when the entry is invalidated", async () => {
    const lane = createLane();
    const pending = pendingLoader();

    readOrCreate(lane, ["tasks"], pending.loader);
    await settlePromiseHandlers();

    expect(pending.signal?.aborted).toBe(false);
    lane.invalidate(["tasks"]);
    expect(pending.signal?.aborted).toBe(true);
  });

  it("aborts the in-flight loader when the entry is removed", async () => {
    const lane = createLane();
    const pending = pendingLoader();

    readOrCreate(lane, ["tasks"], pending.loader);
    await settlePromiseHandlers();

    lane.remove(["tasks"]);
    expect(pending.signal?.aborted).toBe(true);
  });

  it("aborts a pending load when set publishes an authoritative value", async () => {
    const lane = createLane();
    const pending = pendingLoader();

    readOrCreate(lane, ["tasks"], pending.loader);
    await settlePromiseHandlers();

    lane.set(["tasks"], "authoritative");

    expect(pending.signal?.aborted).toBe(true);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "unused"),
    ).resolves.toEqual({ data: "authoritative" });
  });

  it("does not abort when update chains on the in-flight value", async () => {
    const lane = createLane();
    let signal: AbortSignal | undefined;
    const value = deferred<string>();
    const loader = vi.fn((context: LaneLoaderContext) => {
      signal = context.signal;
      return value.promise;
    });

    readOrCreate(lane, ["tasks"], loader);
    await settlePromiseHandlers();

    const updated = lane.update<string>(["tasks"], (current) => `${current}!`);

    expect(signal?.aborted).toBe(false);
    value.resolve("loaded");

    await expect(updated).resolves.toEqual({ data: "loaded!" });
    expect(signal?.aborted).toBe(false);
  });
});
