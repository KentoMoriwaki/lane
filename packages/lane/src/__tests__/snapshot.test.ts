import { describe, expect, expectTypeOf, it } from "vitest";
import {
  infiniteLaneRead,
  laneKey,
  laneRead,
  laneSnapshot,
} from "../index";
import type { LaneKeyOf, LaneSnapshot } from "../types";
import type { InfiniteLaneValue } from "../use-infinite-lane";

describe("laneSnapshot", () => {
  it("pairs a key with the value seeded under it", () => {
    const key = laneKey<string>(["task", "t1"]);

    expect(laneSnapshot(key, "T1")).toEqual({ data: "T1", key });
  });

  it("takes a read's own key, so the seed names the read's entry", () => {
    const read = laneRead({
      key: ["task", "t1"],
      loader: async () => "T1",
    });

    // The very same array, not a copy: the seed addresses the entry the read
    // does, which is the point of accepting a read rather than a restated key.
    expect(laneSnapshot(read, "T1").key).toBe(read.key);
  });

  it("takes an infinite read's key too", () => {
    const read = infiniteLaneRead({
      key: ["feed"],
      initialCursor: 0,
      fetchPage: async (cursor: number) => ({ items: ["a"], next: cursor + 1 }),
      nextCursor: (page) => page.next,
    });
    const value = { hasNext: true, pages: [{ items: ["a"], next: 1 }], params: [0] };

    expect(laneSnapshot(read, value)).toEqual({ data: value, key: read.key });
  });

  it("does not call the read's loader", () => {
    let called = false;
    const read = laneRead({
      key: ["task", "t1"],
      loader: async () => {
        called = true;
        return "T1";
      },
    });

    laneSnapshot(read, "T1");

    expect(called).toBe(false);
  });
});

/**
 * Type-level expectations. Never called — `pnpm typecheck` is what enforces them.
 */
function typeExpectations(): void {
  type Task = { id: string; title: string };
  const task: Task = { id: "t1", title: "Write" };

  const detail = laneRead({ key: ["task", task.id], loader: async () => task });
  const list = laneRead({ key: ["tasks"], loader: async () => [task] });

  // `T` comes from the key the read carries, and `data` is checked against it.
  expectTypeOf(laneSnapshot(detail, task)).toEqualTypeOf<LaneSnapshot<Task>>();
  expectTypeOf(laneSnapshot(detail.key, task)).toEqualTypeOf<LaneSnapshot<Task>>();
  expectTypeOf(laneSnapshot(list, [task])).toEqualTypeOf<LaneSnapshot<Task[]>>();

  // @ts-expect-error — not what this read's entry holds.
  laneSnapshot(detail, { title: "no id" });
  // @ts-expect-error — the entry holds one Task, not a list of them.
  laneSnapshot(detail, [task]);
  // @ts-expect-error — same check through the key.
  laneSnapshot(detail.key, "not a task");

  // A key declared by hand works the same way.
  const taskKeys = { detail: (id: string) => laneKey<Task>(["task", id]) };
  expectTypeOf(laneSnapshot(taskKeys.detail(task.id), task)).toEqualTypeOf<
    LaneSnapshot<Task>
  >();
  // @ts-expect-error — the key says Task.
  laneSnapshot(taskKeys.detail(task.id), 42);

  // An infinite read's key holds the accumulated list, so that is what is checked.
  const feed = infiniteLaneRead({
    key: ["feed"],
    initialCursor: 0,
    fetchPage: async (cursor: number) => ({ rows: [task], next: cursor + 1 }),
    nextCursor: (page) => page.next,
  });
  type FeedPage = { rows: Task[]; next: number };
  expectTypeOf(feed.key).toEqualTypeOf<
    LaneKeyOf<InfiniteLaneValue<FeedPage, number>>
  >();
  expectTypeOf(
    laneSnapshot(feed, { hasNext: true, pages: [], params: [] }),
  ).toEqualTypeOf<LaneSnapshot<InfiniteLaneValue<FeedPage, number>>>();
  // @ts-expect-error — one page is not the accumulated value.
  laneSnapshot(feed, { rows: [task], next: 1 });

  // A plain key carries no type, so the value decides it — as with `lane.set`.
  expectTypeOf(laneSnapshot(["task", task.id], task)).toEqualTypeOf<
    LaneSnapshot<Task>
  >();
}

void typeExpectations;
