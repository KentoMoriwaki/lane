import { afterEach, describe, expect, it, vi } from "vitest";
import { latestNotifySource, readOrCreate } from "../core";
import { hydrateMany } from "../hydrate";
import { createLane, LaneOwnershipError } from "../index";
import { serializeKey } from "../keys";
import type { LaneRead } from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribeInvalidate,
  subscribeRemove,
} from "./test-utils";

afterEach(resetVitest);

describe("readOrCreate", () => {
  it("creates a promise only when the key slot has no cache", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const first = readOrCreate(lane, ["tasks"], loader);
    const second = readOrCreate(lane, ["tasks"], loader);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not perform stale policy while reading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const loader = vi.fn(async () => "new");

    lane.set(["tasks"], "cached");
    vi.setSystemTime(60_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "cached" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("subscribing before any read does not create a cache", async () => {
    const lane = createLane();
    const listener = vi.fn();
    const loader = vi.fn(async () => "loaded");

    subscribeInvalidate(lane, ["tasks"], listener);
    const first = readOrCreate(lane, ["tasks"], loader);
    const second = readOrCreate(lane, ["tasks"], loader);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("normalizes synchronous loader failures into the cached promise", async () => {
    const lane = createLane();
    const error = new Error("network");
    const loader = vi.fn<() => Promise<string>>(() => {
      throw error;
    });

    const first = readOrCreate(lane, ["tasks"], loader);
    const second = readOrCreate(lane, ["tasks"], async () => "loaded");

    expect(second).toBe(first);
    await expect(first).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("hydrateMany", () => {
  it("authoritatively overwrites existing cache and notifies invalidate subscribers", async () => {
    const lane = createLane();
    const invalidateListener = vi.fn();
    const removeListener = vi.fn();
    const loader = vi.fn(async () => "loaded");

    lane.set(["tasks"], "client");
    subscribeInvalidate(lane, ["tasks"], invalidateListener);
    subscribeRemove(lane, ["tasks"], removeListener);

    hydrateMany(lane, {
      entries: [{ key: ["tasks"], data: "server" }],
    });

    expect(invalidateListener).toHaveBeenCalledTimes(1);
    expect(invalidateListener).toHaveBeenCalledWith(
      {
        key: ["tasks"],
        keyId: serializeKey(["tasks"]),
      },
      "transition",
      undefined,
    );
    expect(removeListener).not.toHaveBeenCalled();
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "server" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("ignores settlement from an older promise after hydration replaces it", async () => {
    const lane = createLane();
    const old = deferred<string>();
    const loader = vi.fn(async () => "loaded");

    lane.set(["tasks"], old.promise);
    hydrateMany(lane, {
      entries: [{ key: ["tasks"], data: "server" }],
    });

    old.resolve("old");
    await settlePromiseHandlers();

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "server" });
    expect(loader).not.toHaveBeenCalled();
  });

  // Hydration seeds an *external* entry, so the client cannot invalidate it —
  // which is what makes the freshness stamp observable here: the `onlyIf: "stale"`
  // gate runs first, so the same call is a silent no-op while the seed is fresh
  // and an ownership violation once it is not.
  it("sets freshness metadata from hydration time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const lane = createLane();
    const listener = vi.fn();

    hydrateMany(lane, {
      entries: [{ key: ["tasks"], data: "server" }],
    });
    subscribeInvalidate(lane, ["tasks"], listener);

    vi.setSystemTime(10_999);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "too-early"),
    ).resolves.toEqual({ data: "server" });

    vi.setSystemTime(11_000);

    expect(() =>
      lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 }),
    ).toThrow(LaneOwnershipError);

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "after-stale"),
    ).resolves.toEqual({ data: "server" });
  });

  it("sets freshness metadata from publication time on a client-owned key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "published");
    subscribeInvalidate(lane, ["tasks"], listener);

    vi.setSystemTime(10_999);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "too-early"),
    ).resolves.toEqual({ data: "published" });

    vi.setSystemTime(11_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "after-stale"),
    ).resolves.toEqual({ data: "after-stale" });
  });

  // `staleTime` defaults to Infinity: nothing is stale until an app says what
  // stale means. Every revalidation trigger set to `true` funnels into this
  // invalidation, so the default is what decides whether it can ever fire.
  it("treats a missing staleTime as never stale, and 0 as always stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "value");
    subscribeInvalidate(lane, ["tasks"], listener);

    // A century later, still not stale.
    vi.setSystemTime(10_000 + 100 * 365 * 24 * 60 * 60_000);
    lane.invalidate(["tasks"], { onlyIf: "stale" });

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "refetched"),
    ).resolves.toEqual({ data: "value" });

    // `staleTime: 0` is how an app asks for "always stale" — and owns the
    // consequences, including a mount that refetches what it just loaded.
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 0 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "refetched"),
    ).resolves.toEqual({ data: "refetched" });
  });
});

describe("invalidate", () => {
  it("clears the cache before notifying so multiple subscribers re-read one promise", async () => {
    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("after");
    const observed: Promise<LaneRead<string>>[] = [];

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "before" });

    subscribeInvalidate(lane, ["tasks"], () => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });
    subscribeInvalidate(lane, ["tasks"], () => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });

    lane.invalidate(["tasks"]);

    expect(observed).toHaveLength(2);
    expect(observed[1]).toBe(observed[0]);
    await expect(observed[0]).resolves.toEqual({ data: "after" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("can abandon a pending cache without letting its later settlement revive stale data", async () => {
    const lane = createLane();
    const pending = deferred<string>();
    const listener = vi.fn();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], pending.promise);
    subscribeInvalidate(lane, ["tasks"], listener);

    lane.invalidate(["tasks"]);

    expect(listener).toHaveBeenCalledTimes(1);
    const reloaded = readOrCreate(lane, ["tasks"], loader);
    expect(reloaded).not.toBe(pending.promise);

    pending.resolve("old");
    await settlePromiseHandlers();

    await expect(reloaded).resolves.toEqual({ data: "fresh" });
    await expect(
      readOrCreate(lane, ["tasks"], async () => "unexpected"),
    ).resolves.toEqual({ data: "fresh" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("notifies exact-key subscribers only", async () => {
    const lane = createLane();
    const tasksListener = vi.fn();
    const teamsListener = vi.fn();

    lane.set(["tasks"], "tasks");
    lane.set(["teams"], "teams");
    subscribeInvalidate(lane, ["tasks"], tasksListener);
    subscribeInvalidate(lane, ["teams"], teamsListener);

    lane.invalidate(["tasks"]);

    expect(tasksListener).toHaveBeenCalledTimes(1);
    expect(tasksListener).toHaveBeenCalledWith(
      {
        key: ["tasks"],
        keyId: serializeKey(["tasks"]),
      },
      "transition",
      undefined,
    );
    expect(teamsListener).not.toHaveBeenCalled();
  });

  it("subscribers attached before the entry exists receive later notifications", () => {
    const lane = createLane();
    const listener = vi.fn();

    subscribeInvalidate(lane, ["tasks"], listener);
    lane.set(["tasks"], "value");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not call unsubscribed listeners", () => {
    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "tasks");
    const unsubscribe = subscribeInvalidate(lane, ["tasks"], listener);
    unsubscribe();
    lane.invalidate(["tasks"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("invalidates all existing entries matching a prefix scope", async () => {
    const lane = createLane();
    const taskListA = vi.fn();
    const taskListB = vi.fn();
    const taskDetail = vi.fn();
    const teams = vi.fn();

    lane.set(["tasks", { status: "todo" }], "todo-list");
    lane.set(["tasks", { status: "done" }], "done-list");
    lane.set(["task", "task_1"], "task-detail");
    lane.set(["teams"], "teams");

    subscribeInvalidate(lane, ["tasks", { status: "todo" }], taskListA);
    subscribeInvalidate(lane, ["tasks", { status: "done" }], taskListB);
    subscribeInvalidate(lane, ["task", "task_1"], taskDetail);
    subscribeInvalidate(lane, ["teams"], teams);

    lane.invalidateAll(["tasks"]);

    expect(taskListA).toHaveBeenCalledTimes(1);
    expect(taskListB).toHaveBeenCalledTimes(1);
    expect(taskDetail).not.toHaveBeenCalled();
    expect(teams).not.toHaveBeenCalled();

    await expect(
      readOrCreate(lane, ["tasks", { status: "todo" }], async () => "todo-new"),
    ).resolves.toEqual({ data: "todo-new" });
    await expect(
      readOrCreate(lane, ["tasks", { status: "done" }], async () => "done-new"),
    ).resolves.toEqual({ data: "done-new" });
    await expect(
      readOrCreate(lane, ["task", "task_1"], async () => "detail-new"),
    ).resolves.toEqual({ data: "task-detail" });
  });

  it("invalidates all entries matching a predicate scope", () => {
    const lane = createLane();
    const labelListener = vi.fn();
    const taskListener = vi.fn();

    lane.set(["labels"], "labels");
    lane.set(["tasks"], "tasks");
    subscribeInvalidate(lane, ["labels"], labelListener);
    subscribeInvalidate(lane, ["tasks"], taskListener);

    lane.invalidateAll((entry) => entry.keyId === serializeKey(["labels"]));

    expect(labelListener).toHaveBeenCalledTimes(1);
    expect(taskListener).not.toHaveBeenCalled();
  });
});

describe("conditional invalidation", () => {
  it("settled-only invalidation skips pending cache", async () => {
    const lane = createLane();
    const pending = deferred<string>();
    const listener = vi.fn();

    const cached = lane.set(["tasks"], pending.promise);
    subscribeInvalidate(lane, ["tasks"], listener);

    lane.invalidate(["tasks"], { onlyIf: "settled" });

    expect(listener).not.toHaveBeenCalled();
    expect(readOrCreate(lane, ["tasks"], async () => "new")).toBe(cached);

    pending.resolve("done");
    await expect(cached).resolves.toEqual({ data: "done" });
  });

  it("settled-only invalidation clears fulfilled and rejected cache", async () => {
    const lane = createLane();
    const fulfilledListener = vi.fn();
    const rejectedListener = vi.fn();
    const rejected = Promise.reject(new Error("network"));
    rejected.catch(() => undefined);

    lane.set(["fulfilled"], "value");
    lane.set(["rejected"], rejected);
    subscribeInvalidate(lane, ["fulfilled"], fulfilledListener);
    subscribeInvalidate(lane, ["rejected"], rejectedListener);

    await rejected.catch(() => undefined);
    await settlePromiseHandlers();

    lane.invalidate(["fulfilled"], { onlyIf: "settled" });
    lane.invalidate(["rejected"], { onlyIf: "settled" });

    expect(fulfilledListener).toHaveBeenCalledTimes(1);
    expect(rejectedListener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["fulfilled"], async () => "new-fulfilled"),
    ).resolves.toEqual({ data: "new-fulfilled" });
    await expect(
      readOrCreate(lane, ["rejected"], async () => "new-rejected"),
    ).resolves.toEqual({ data: "new-rejected" });
  });

  it("stale invalidation only clears fulfilled cache after staleTime elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "fresh");
    subscribeInvalidate(lane, ["tasks"], listener);

    vi.setSystemTime(1_999);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "too-early"),
    ).resolves.toEqual({ data: "fresh" });

    vi.setSystemTime(2_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toEqual({ data: "reloaded" });
  });

  it("measures staleness from promise settlement time, not creation time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const pending = deferred<string>();
    const listener = vi.fn();

    lane.set(["tasks"], pending.promise);
    subscribeInvalidate(lane, ["tasks"], listener);

    vi.setSystemTime(10_000);
    pending.resolve("loaded");
    await settlePromiseHandlers();

    vi.setSystemTime(10_999);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "too-early"),
    ).resolves.toEqual({ data: "loaded" });

    vi.setSystemTime(11_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toEqual({ data: "reloaded" });
  });

  it("stale invalidation skips pending and rejected cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const pending = deferred<string>();
    const rejected = Promise.reject(new Error("network"));
    const pendingListener = vi.fn();
    const rejectedListener = vi.fn();

    rejected.catch(() => undefined);
    const cachedPending = lane.set(["pending"], pending.promise);
    lane.set(["rejected"], rejected);
    subscribeInvalidate(lane, ["pending"], pendingListener);
    subscribeInvalidate(lane, ["rejected"], rejectedListener);

    await rejected.catch(() => undefined);
    await settlePromiseHandlers();
    vi.setSystemTime(10_000);

    lane.invalidate(["pending"], { onlyIf: "stale", staleTime: 1 });
    lane.invalidate(["rejected"], { onlyIf: "stale", staleTime: 1 });

    expect(pendingListener).not.toHaveBeenCalled();
    expect(rejectedListener).not.toHaveBeenCalled();
    expect(readOrCreate(lane, ["pending"], async () => "new-pending")).toBe(
      cachedPending,
    );
    await expect(
      readOrCreate(lane, ["rejected"], async () => "new-rejected"),
    ).rejects.toThrow("network");

    pending.resolve("done");
    await expect(cachedPending).resolves.toEqual({ data: "done" });
  });
});

// Focus / reconnect dispatch now lives in the provider (see provider.test.ts and
// the focus/reconnect cases in react-integration.test.ts); the store has no
// notion of them. Its role here is the conditional invalidation each reader
// fires — covered by the "conditional invalidation" suite above.

describe("latestNotifySource", () => {
  it("records the source of the last notification for a key", () => {
    const lane = createLane();

    // Never notified — a reader catching up here has nothing user-driven to join.
    lane.set(["tasks"], "cached");
    expect(latestNotifySource(lane, serializeKey(["other"]))).toBeUndefined();

    // `set` publishes through the explicit transition.
    expect(latestNotifySource(lane, serializeKey(["tasks"]))).toBe("transition");

    subscribeInvalidate(lane, ["tasks"], () => {});
    lane.invalidate(["tasks"], { background: true });
    expect(latestNotifySource(lane, serializeKey(["tasks"]))).toBe("background");

    lane.invalidate(["tasks"]);
    expect(latestNotifySource(lane, serializeKey(["tasks"]))).toBe("transition");
  });
});
