import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate } from "../core";
import { createLane } from "../index";
import { replaceEqualDeep } from "../structural";
import { resetVitest, subscribeInvalidate } from "./test-utils";

afterEach(resetVitest);

describe("replaceEqualDeep", () => {
  it("returns the previous reference when the next value is deeply equal", () => {
    const prev = { tasks: [{ id: 1, tags: ["a"] }], total: 1 };
    const next = { tasks: [{ id: 1, tags: ["a"] }], total: 1 };

    expect(replaceEqualDeep(prev, next)).toBe(prev);
  });

  it("reuses unchanged subtrees when part of the value changes", () => {
    const prev = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const next = [
      { id: 1, name: "a" },
      { id: 2, name: "changed" },
    ];

    const merged = replaceEqualDeep(prev, next);

    expect(merged).not.toBe(prev);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).not.toBe(prev[1]);
    expect(merged[1]).toEqual({ id: 2, name: "changed" });
  });

  it("replaces values of different shapes", () => {
    expect(replaceEqualDeep({ a: 1 }, [1])).toEqual([1]);
    expect(replaceEqualDeep("a", "b")).toBe("b");
    expect(replaceEqualDeep(undefined, "b")).toBe("b");
    expect(replaceEqualDeep(null, "b")).toBe("b");
  });

  it("does not reuse the previous value when keys are added or removed", () => {
    const prev = { a: 1, b: 2 };

    const shrunk = replaceEqualDeep(prev, { a: 1 });
    expect(shrunk).toEqual({ a: 1 });
    expect(shrunk).not.toBe(prev);

    const grown = replaceEqualDeep(prev, { a: 1, b: 2, c: 3 });
    expect(grown).toEqual({ a: 1, b: 2, c: 3 });
    expect(grown).not.toBe(prev);
  });
});

describe("structural sharing across reloads", () => {
  it("keeps the previous reference when a reload returns deeply equal data", async () => {
    const lane = createLane();
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    const first = await readOrCreate(lane, ["tasks"], async () => [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);

    lane.invalidate(["tasks"]);
    const second = await readOrCreate(lane, ["tasks"], async () => [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);

    expect(second.data).toBe(first.data);
  });

  it("reuses unchanged items when a reload changes part of the data", async () => {
    const lane = createLane();
    subscribeInvalidate(lane, ["tasks"], vi.fn());

    const first = await readOrCreate(lane, ["tasks"], async () => [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);

    lane.invalidate(["tasks"]);
    const second = await readOrCreate(lane, ["tasks"], async () => [
      { id: 1, name: "a" },
      { id: 2, name: "renamed" },
    ]);

    expect(second.data).not.toBe(first.data);
    expect(second.data[0]).toBe(first.data[0]);
    expect(second.data[1]).toEqual({ id: 2, name: "renamed" });
  });
});
