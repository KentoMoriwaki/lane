import { afterEach, describe, expect, it } from "vitest";
import { serializeKey } from "../keys";
import { resetVitest } from "./test-utils";

afterEach(resetVitest);

describe("serializeKey", () => {
  it("keeps structural object keys stable across property order", () => {
    expect(serializeKey(["tasks", { status: "todo", q: "search" }])).toBe(
      serializeKey(["tasks", { q: "search", status: "todo" }]),
    );
  });

  it("serializes Date segments by timestamp", () => {
    expect(serializeKey(["tasks", new Date(0)])).toBe(
      serializeKey(["tasks", new Date(0)]),
    );
    expect(serializeKey(["tasks", new Date(0)])).not.toBe(
      serializeKey(["tasks", new Date(1)]),
    );
    expect(serializeKey(["tasks", { due: new Date(0) }])).toBe(
      serializeKey(["tasks", { due: new Date(0) }]),
    );
  });

  it("does not collide Date segments with their ISO string", () => {
    expect(serializeKey(["tasks", new Date(0)])).not.toBe(
      serializeKey(["tasks", "1970-01-01T00:00:00.000Z"]),
    );
  });

  it("keeps invalid Date segments stable instead of throwing", () => {
    expect(serializeKey(["tasks", new Date(Number.NaN)])).toBe(
      serializeKey(["tasks", new Date(Number.NaN)]),
    );
  });

  it("throws for unsupported key segments instead of silently collapsing them", () => {
    expect(() => serializeKey(["tasks", new Map()])).toThrow(
      "Unsupported Lane key value",
    );
    expect(() => serializeKey(["tasks", () => "fn"])).toThrow(
      "Unsupported Lane key value",
    );
  });
});
