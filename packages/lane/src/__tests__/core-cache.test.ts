import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateMany, readOrCreate, refetchOnFocus } from "../core";
import { createLane } from "../index";
import { serializeKey } from "../keys";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribeInvalidate,
  subscribeRemove,
  subscribeWithOptions,
} from "./test-utils";

afterEach(resetVitest);

describe("readOrCreate", () => {
  it("creates a promise only when the key slot has no cache", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const first = readOrCreate(lane, ["tasks"], loader);
    const second = readOrCreate(lane, ["tasks"], loader);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not perform stale policy while reading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const loader = vi.fn(async () => "new");

    lane.set(["tasks"], "cached");
    vi.setSystemTime(60_000);

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe("cached");
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not create a cache or entry for a missing subscription target", async () => {
    const lane = createLane();
    const listener = vi.fn();
    const loader = vi.fn(async () => "loaded");

    subscribeInvalidate(lane, ["tasks"], listener);
    const first = readOrCreate(lane, ["tasks"], loader);
    const second = readOrCreate(lane, ["tasks"], loader);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("loaded");
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
  it("authoritatively replaces existing cache without notifying subscribers", async () => {
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

    expect(invalidateListener).not.toHaveBeenCalled();
    expect(removeListener).not.toHaveBeenCalled();
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe("server");
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

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe("server");
    expect(loader).not.toHaveBeenCalled();
  });

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
    ).resolves.toBe("server");

    vi.setSystemTime(11_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "after-stale"),
    ).resolves.toBe("after-stale");
  });
});

describe("invalidate", () => {
  it("clears the cache before notifying so multiple subscribers re-read one promise", async () => {
    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("after");
    const observed: Promise<string>[] = [];

    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe("before");

    subscribeInvalidate(lane, ["tasks"], () => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });
    subscribeInvalidate(lane, ["tasks"], () => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });

    lane.invalidate(["tasks"]);

    expect(observed).toHaveLength(2);
    expect(observed[1]).toBe(observed[0]);
    await expect(observed[0]).resolves.toBe("after");
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

    await expect(reloaded).resolves.toBe("fresh");
    await expect(
      readOrCreate(lane, ["tasks"], async () => "unexpected"),
    ).resolves.toBe("fresh");
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
    );
    expect(teamsListener).not.toHaveBeenCalled();
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
    ).resolves.toBe("todo-new");
    await expect(
      readOrCreate(lane, ["tasks", { status: "done" }], async () => "done-new"),
    ).resolves.toBe("done-new");
    await expect(
      readOrCreate(lane, ["task", "task_1"], async () => "detail-new"),
    ).resolves.toBe("task-detail");
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

    lane.set(["tasks"], pending.promise);
    subscribeInvalidate(lane, ["tasks"], listener);

    lane.invalidate(["tasks"], { onlyIf: "settled" });

    expect(listener).not.toHaveBeenCalled();
    expect(readOrCreate(lane, ["tasks"], async () => "new")).toBe(
      pending.promise,
    );

    pending.resolve("done");
    await expect(pending.promise).resolves.toBe("done");
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
    ).resolves.toBe("new-fulfilled");
    await expect(
      readOrCreate(lane, ["rejected"], async () => "new-rejected"),
    ).resolves.toBe("new-rejected");
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
    ).resolves.toBe("fresh");

    vi.setSystemTime(2_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toBe("reloaded");
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
    ).resolves.toBe("loaded");

    vi.setSystemTime(11_000);
    lane.invalidate(["tasks"], { onlyIf: "stale", staleTime: 1_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toBe("reloaded");
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
    lane.set(["pending"], pending.promise);
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
      pending.promise,
    );
    await expect(
      readOrCreate(lane, ["rejected"], async () => "new-rejected"),
    ).rejects.toThrow("network");

    pending.resolve("done");
    await expect(pending.promise).resolves.toBe("done");
  });
});

describe("focus refetch", () => {
  it("invalidates each focused stale entry once using the most aggressive staleTime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("reloaded");
    const observed: Promise<string>[] = [];
    const firstListener = vi.fn(() => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });
    const secondListener = vi.fn(() => {
      observed.push(readOrCreate(lane, ["tasks"], loader));
    });

    lane.set(["tasks"], "cached");
    subscribeWithOptions(
      lane,
      ["tasks"],
      {
        refetchOnFocus: true,
        staleTime: 10_000,
      },
      firstListener,
    );
    subscribeWithOptions(
      lane,
      ["tasks"],
      {
        refetchOnFocus: true,
        staleTime: 1_000,
      },
      secondListener,
    );

    vi.setSystemTime(1_999);
    refetchOnFocus(lane);

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "too-early"),
    ).resolves.toBe("cached");

    vi.setSystemTime(2_000);
    refetchOnFocus(lane);

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(observed).toHaveLength(2);
    expect(observed[1]).toBe(observed[0]);
    await expect(observed[0]).resolves.toBe("reloaded");
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toBe(
      "reloaded",
    );
  });

  it("always-focused subscribers invalidate settled cache even when it is fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeWithOptions(
      lane,
      ["tasks"],
      {
        refetchOnFocus: "always",
        staleTime: 60_000,
      },
      listener,
    );

    refetchOnFocus(lane);

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toBe("reloaded");
  });

  it("does not invalidate entries without focus subscribers", async () => {
    const lane = createLane();
    const listener = vi.fn();

    lane.set(["tasks"], "cached");
    subscribeWithOptions(lane, ["tasks"], {
      refetchOnFocus: false,
      staleTime: 0,
    }, listener);

    refetchOnFocus(lane);

    expect(listener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks"], async () => "reloaded"),
    ).resolves.toBe("cached");
  });
});
