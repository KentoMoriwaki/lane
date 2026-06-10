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

  it("throws for unsupported key segments instead of silently collapsing them", () => {
    expect(() => serializeKey(["tasks", new Date(0)])).toThrow(
      "Unsupported Lane key value",
    );
  });
});
