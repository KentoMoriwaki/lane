/**
 * What a Server Component may call. `use-lane` puts `"use client"` on the
 * modules that touch React and nowhere else, so the builders a route uses to
 * seed the lane — `laneRead`, `laneKey`, `laneSnapshot`, `infiniteLaneRead`,
 * `infiniteLaneSnapshot`, `createLane` — are callable from the server. A
 * function that lives in a client module cannot be called there, only rendered
 * ("Attempted to call infiniteLaneRead() from the server but infiniteLaneRead
 * is on the client"), which is how this was first noticed. This pins the
 * boundary at the source, where it is decided.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createLane,
  external,
  infiniteLaneRead,
  infiniteLaneSnapshot,
  laneKey,
  laneRead,
  laneSnapshot,
} from "../index";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function directive(file: string): string | undefined {
  const first = readFileSync(join(src, file), "utf8").trimStart();

  return /^(["'])use client\1/.exec(first)?.[0];
}

describe("what a Server Component may call", () => {
  it.each([
    "index.ts",
    "core.ts",
    "keys.ts",
    "read-spec.ts",
    "snapshot.ts",
    "infinite-read.ts",
    "external.ts",
  ])("%s carries no client directive", (file) => {
    expect(directive(file)).toBeUndefined();
  });

  it.each(["use-lane.ts", "use-infinite-lane.ts", "use-lanes-all.ts", "provider.ts", "hydration.ts"])(
    "%s is a client module",
    (file) => {
      expect(directive(file)).toBeDefined();
    },
  );

  it("builds an infinite read and its first-page snapshot without React", () => {
    const feed = infiniteLaneRead<{ items: string[]; next: string | null }, string | null>({
      key: ["feed"],
      loader: external,
      fetchPage: async () => ({ items: [], next: null }),
      nextCursor: (page) => page.next,
    });
    const snapshot = infiniteLaneSnapshot(feed, { items: ["a"], next: "b" }, null);

    expect(snapshot.key).toEqual(["feed"]);
    expect(snapshot.data).toEqual({
      hasNext: true,
      pages: [{ items: ["a"], next: "b" }],
      params: [null],
    });
    // The rest of the server-side vocabulary, for the same reason.
    expect(laneSnapshot(laneRead<string>({ key: ["k"], loader: external }), "v").key).toEqual(["k"]);
    expect(laneKey<string>(["k2"])).toEqual(["k2"]);
    expect(typeof createLane).toBe("function");
  });
});
