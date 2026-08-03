import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "./test-utils";
import { createLane } from "../index";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribeInvalidate,
  subscribeRemove,
} from "./test-utils";

afterEach(resetVitest);

describe("set, update, and remove", () => {
  it("set replaces cache and notifies invalidate subscribers", async () => {
    const lane = createLane();
    const listener = vi.fn();
    const loader = vi.fn(async () => "loaded");

    lane.set(["tasks"], "old");
    subscribeInvalidate(lane, ["tasks"], listener);
    await expect(lane.set(["tasks"], "new")).resolves.toEqual({ data: "new" });

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "new" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("update chains from the current cached promise without storing a resolved value", async () => {
    const lane = createLane();
    const current = deferred<number>();
    const listener = vi.fn();

    lane.set(["count"], current.promise);
    subscribeInvalidate(lane, ["count"], listener);
    const updated = lane.update<number>(["count"], (value, entry) => {
      expect(entry.key).toEqual(["count"]);
      return value + 1;
    });

    expect(listener).toHaveBeenCalledTimes(1);
    current.resolve(1);

    await expect(updated).resolves.toEqual({ data: 2 });
    await expect(readOrCreate(lane, ["count"], async () => 100)).resolves.toEqual({ data: 2 });
  });

  it("update skips missing and rejected cache", async () => {
    const lane = createLane();
    const rejected = Promise.reject(new Error("network"));
    rejected.catch(() => undefined);

    expect(lane.update(["missing"], () => "ignored")).toBeUndefined();

    lane.set(["rejected"], rejected);
    await rejected.catch(() => undefined);
    await settlePromiseHandlers();

    expect(lane.update(["rejected"], () => "ignored")).toBeUndefined();
  });

  it("updateAll updates only matching cached entries and notifies those entries", async () => {
    const lane = createLane();
    const todoListener = vi.fn();
    const doneListener = vi.fn();
    const teamsListener = vi.fn();

    lane.set(["tasks", { status: "todo" }], 1);
    lane.set(["tasks", { status: "done" }], 10);
    lane.set(["teams"], 100);
    subscribeInvalidate(lane, ["tasks", { status: "todo" }], todoListener);
    subscribeInvalidate(lane, ["tasks", { status: "done" }], doneListener);
    subscribeInvalidate(lane, ["teams"], teamsListener);

    const updates = lane.updateAll<number>(["tasks"], (value) => value + 1);

    expect(updates).toHaveLength(2);
    expect(todoListener).toHaveBeenCalledTimes(1);
    expect(doneListener).toHaveBeenCalledTimes(1);
    expect(teamsListener).not.toHaveBeenCalled();
    await expect(Promise.all(updates)).resolves.toEqual(
      expect.arrayContaining([{ data: 2 }, { data: 11 }]),
    );
    await expect(
      readOrCreate(lane, ["tasks", { status: "todo" }], async () => 0),
    ).resolves.toEqual({ data: 2 });
    await expect(
      readOrCreate(lane, ["tasks", { status: "done" }], async () => 0),
    ).resolves.toEqual({ data: 11 });
    await expect(
      readOrCreate(lane, ["teams"], async () => 0),
    ).resolves.toEqual({ data: 100 });
  });

  it("remove clears cache, notifies remove subscribers, and does not notify invalidate subscribers", async () => {
    const lane = createLane();
    const removeListener = vi.fn();
    const invalidateListener = vi.fn();
    const loader = vi.fn(async () => "fresh");

    lane.set(["tasks"], "cached");
    subscribeRemove(lane, ["tasks"], removeListener);
    subscribeInvalidate(lane, ["tasks"], invalidateListener);

    lane.remove(["tasks"]);

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(invalidateListener).not.toHaveBeenCalled();
    await expect(readOrCreate(lane, ["tasks"], loader)).resolves.toEqual({ data: "fresh" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("removeAll removes only matching entries and notifies remove subscribers", async () => {
    const lane = createLane();
    const todoRemoveListener = vi.fn();
    const doneRemoveListener = vi.fn();
    const teamsRemoveListener = vi.fn();
    const todoInvalidateListener = vi.fn();

    lane.set(["tasks", { status: "todo" }], "todo");
    lane.set(["tasks", { status: "done" }], "done");
    lane.set(["teams"], "teams");
    subscribeRemove(lane, ["tasks", { status: "todo" }], todoRemoveListener);
    subscribeRemove(lane, ["tasks", { status: "done" }], doneRemoveListener);
    subscribeRemove(lane, ["teams"], teamsRemoveListener);
    subscribeInvalidate(
      lane,
      ["tasks", { status: "todo" }],
      todoInvalidateListener,
    );

    lane.removeAll(["tasks"]);

    expect(todoRemoveListener).toHaveBeenCalledTimes(1);
    expect(doneRemoveListener).toHaveBeenCalledTimes(1);
    expect(teamsRemoveListener).not.toHaveBeenCalled();
    expect(todoInvalidateListener).not.toHaveBeenCalled();
    await expect(
      readOrCreate(lane, ["tasks", { status: "todo" }], async () => "todo-new"),
    ).resolves.toEqual({ data: "todo-new" });
    await expect(
      readOrCreate(lane, ["tasks", { status: "done" }], async () => "done-new"),
    ).resolves.toEqual({ data: "done-new" });
    await expect(
      readOrCreate(lane, ["teams"], async () => "teams-new"),
    ).resolves.toEqual({ data: "teams" });
  });
});
