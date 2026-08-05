/**
 * `LaneRead.revision`: the identity of an entry's content, minted from a
 * lane-wide counter exactly when a fulfillment installs a *new reference* —
 * which structural sharing has already decided. The contract under test:
 *
 * - equality is the whole meaning: same revision ⇔ same content (reference)
 * - a deep-equal refetch keeps the reference, so it keeps the revision
 * - stale-on-error serves the old data under the old revision
 * - numbers are lane-wide, so no entry generation can re-issue another's
 * - an external read carries no revision at all
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateMany } from "../hydrate";
import { createLane, external } from "../index";
import {
  deferred,
  readOrCreate,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
} from "./test-utils";

afterEach(resetVitest);

describe("LaneRead.revision", () => {
  it("mints a revision on first fulfillment", async () => {
    const lane = createLane();

    const read = await readOrCreate(lane, ["tasks"], async () => "loaded");

    expect(typeof read.revision).toBe("number");
  });

  it("keeps the revision when a refetch comes back deep-equal", async () => {
    const lane = createLane();
    const unsubscribe = subscribe(lane, ["tasks"]);
    const loader = vi.fn(async () => ({ id: "t1", tags: ["a", "b"] }));

    const first = await readOrCreate(lane, ["tasks"], loader);
    lane.invalidate(["tasks"]);
    const second = await readOrCreate(lane, ["tasks"], loader);

    // Structural sharing collapsed the refetch onto the previous reference;
    // the revision is that fact made serializable, so it must agree.
    expect(second.data).toBe(first.data);
    expect(second.revision).toBe(first.revision);

    unsubscribe();
  });

  it("advances the revision when a refetch comes back changed", async () => {
    const lane = createLane();
    const unsubscribe = subscribe(lane, ["tasks"]);
    let title = "one";
    const loader = vi.fn(async () => ({ id: "t1", title }));

    const first = await readOrCreate(lane, ["tasks"], loader);
    title = "two";
    lane.invalidate(["tasks"]);
    const second = await readOrCreate(lane, ["tasks"], loader);

    expect(second.data).not.toBe(first.data);
    expect(second.revision).not.toBe(first.revision);

    unsubscribe();
  });

  it("serves stale-on-error under the revision of the data it serves", async () => {
    const lane = createLane();
    const unsubscribe = subscribe(lane, ["tasks"]);
    const error = new Error("network");
    let fail = false;
    const loader = vi.fn(async () => {
      if (fail) {
        throw error;
      }

      return "loaded";
    });

    const first = await readOrCreate(lane, ["tasks"], loader);
    fail = true;
    lane.invalidate(["tasks"]);
    const fallback = await readOrCreate(lane, ["tasks"], loader);

    // The old data rides with its own revision — the pair is one settlement,
    // so a derived key built from it still names the content actually shown.
    expect(fallback).toEqual({
      data: "loaded",
      refreshError: error,
      revision: first.revision,
    });

    unsubscribe();
  });

  it("set and update advance the revision exactly when the content changes", async () => {
    const lane = createLane();

    const first = await lane.set(["tasks"], { count: 1 });
    // Deep-equal publish: shared onto the previous reference, same identity.
    const same = await lane.set(["tasks"], { count: 1 });
    const changed = await lane.update<{ count: number }>(["tasks"], (value) => ({
      count: value.count + 1,
    }));

    expect(same.data).toBe(first.data);
    expect(same.revision).toBe(first.revision);
    expect(changed?.revision).not.toBe(first.revision);
  });

  it("never re-issues a number across entry generations", async () => {
    const lane = createLane();
    const unsubscribe = subscribe(lane, ["source"]);
    const loader = vi.fn(async () => "same-content");

    const first = await readOrCreate(lane, ["source"], loader);
    // `remove` ends the entry's client state — and with it the identity: the
    // re-created entry cannot tell "same content as before" from "first load",
    // so it must mint fresh rather than risk colliding with a derived key
    // built from the old generation's numbers.
    lane.remove(["source"]);
    const second = await readOrCreate(lane, ["source"], loader);

    expect(second.data).toBe(first.data);
    expect(second.revision).not.toBe(first.revision);

    unsubscribe();
  });

  it("mints distinct numbers for distinct entries", async () => {
    const lane = createLane();

    const tasks = await readOrCreate(lane, ["tasks"], async () => "a");
    const teams = await readOrCreate(lane, ["teams"], async () => "a");

    // Same content under two keys is still two entries — revisions name an
    // entry's content, not a value, so they must not collide.
    expect(teams.revision).not.toBe(tasks.revision);
  });

  it("gives a displaced read a revision of its own", async () => {
    const lane = createLane();
    const slow = deferred<string>();

    const displaced = readOrCreate(lane, ["tasks"], () => slow.promise);
    const replacement = await lane.set(["tasks"], "replacement");

    slow.resolve("slow-loader");
    const read = await displaced;

    // The late value never became the entry's content, so it must not answer
    // to the entry's revision — one number naming two values would let a
    // reader that held the displaced promise mistake it for current.
    expect(read.data).toBe("slow-loader");
    expect(read.revision).not.toBe(replacement.revision);
  });

  it("mints per publication on an external entry, identical content included", async () => {
    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: { title: "published" } }],
    });
    const first = await readOrCreate<{ title: string }>(
      lane,
      ["task", "t1"],
      external,
    );

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: { title: "published" } }],
    });
    const second = await readOrCreate<{ title: string }>(
      lane,
      ["task", "t1"],
      external,
    );

    // No `lastFulfilled` to compare against (the weak retention forbids the
    // strong reference), so "unchanged" is not a fact the client can establish
    // — an external revision is the publication's identity, and a republish of
    // identical content is a new publication. The safe direction still holds:
    // same revision ⇒ same content.
    expect(second.data).toEqual(first.data);
    expect(second.revision).not.toBe(first.revision);
  });

  it("resolves an external wait with a revision of its own", async () => {
    const lane = createLane();

    // The wait starts before any publication; the publication both displaces
    // it and feeds it (through the abort reason), so its settlement lands on
    // the displaced path and mints — the number differs from the store's for
    // the same value, which external revisions permit ("same number ⇒ same
    // value" is the only promise), and the reveal reconciliation converges
    // the reader onto the store's promise anyway.
    const waiting = readOrCreate<string>(lane, ["task", "t1"], external);
    await settlePromiseHandlers();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    const fromWait = await waiting;
    const fromStore = await readOrCreate<string>(lane, ["task", "t1"], external);

    expect(fromWait.data).toBe("published");
    expect(typeof fromWait.revision).toBe("number");
    expect(fromStore.data).toBe("published");
    expect(typeof fromStore.revision).toBe("number");
  });
});
