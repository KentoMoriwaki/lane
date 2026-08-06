import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrCreate, resetVitest, subscribe } from "./test-utils";
import { createLane, external, LaneReadError, laneSnapshot } from "../index";
import { hydrateMany } from "../hydrate";

afterEach(resetVitest);

// A read that fails with nothing to show throws, and that throw unmounts the
// reader — with it the subscription and the `invalidate` the hook handed it. The
// error is the only thing that reaches the boundary, so it is what carries the
// key back out.
describe("LaneReadError", () => {
  it("wraps the loader's error and names the key that failed", async () => {
    const lane = createLane();
    const cause = new Error("offline");

    const thrown = await readOrCreate(lane, ["task", 7], async () => {
      throw cause;
    }).catch((reason: unknown) => reason);

    expect(thrown).toBeInstanceOf(LaneReadError);
    expect((thrown as LaneReadError).cause).toBe(cause);
    expect((thrown as LaneReadError).key).toEqual(["task", 7]);
    expect((thrown as LaneReadError).keyId).toBe('["task",7]');
    // The wrapper is what gets logged, so it says how it failed and not only
    // that it did.
    expect((thrown as LaneReadError).message).toContain("offline");
  });

  it("wraps a rejection that is not an Error at all", async () => {
    // The argument for wrapping rather than tagging: there is nothing here to
    // hang a property on.
    const lane = createLane();

    const thrown = await readOrCreate(lane, ["k"], () =>
      Promise.reject("nope"),
    ).catch((reason: unknown) => reason);

    expect(thrown).toBeInstanceOf(LaneReadError);
    expect((thrown as LaneReadError).cause).toBe("nope");
    expect((thrown as LaneReadError).message).toContain("nope");
  });

  it("is the same instance for every later read of the rejected key", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => {
      throw new Error("offline");
    });

    const first = await readOrCreate(lane, ["k"], loader).catch(
      (reason: unknown) => reason,
    );

    await expect(readOrCreate(lane, ["k"], loader)).rejects.toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not wrap a failed refresh over data still worth showing", async () => {
    // Nothing was lost here: the reader is still mounted and still holds its own
    // `invalidate`, so there is nothing for an envelope to carry. The error
    // rides beside the value as the loader left it.
    const lane = createLane();
    const cause = new Error("offline");
    let fail = false;
    const loader = async () => {
      if (fail) {
        throw cause;
      }

      return "cached";
    };

    // Subscribed, because that is the shape this is about — a reader that is
    // still there. An entry invalidated with nobody holding it keeps no last
    // value to fall back to, and the reload would be a first load again.
    const unsubscribe = subscribe(lane, ["k"]);

    await expect(readOrCreate(lane, ["k"], loader)).resolves.toEqual({
      revision: expect.any(Number),
      data: "cached",
    });

    fail = true;
    lane.invalidate(["k"]);

    await expect(readOrCreate(lane, ["k"], loader)).resolves.toEqual({
      revision: expect.any(Number),
      data: "cached",
      refreshError: cause,
    });

    unsubscribe();
  });

  it("does not wrap a published key's failure", async () => {
    // Recovering a published key is not the client's to offer — `invalidate`
    // and `remove` both throw on one — so its failures keep their own shape.
    const lane = createLane();

    hydrateMany(lane, {
      entries: [laneSnapshot(["published"], Promise.reject(new Error("gone")))],
    });

    const thrown = await readOrCreate(lane, ["published"], external).catch(
      (reason: unknown) => reason,
    );

    expect(thrown).not.toBeInstanceOf(LaneReadError);
    expect((thrown as Error).message).toBe("gone");
  });
});

// The blunt companion to `error.key`: one boundary can catch only one throw, so
// a subtree with several failed keys needs a way to say "retry what is broken"
// without naming any of them.
describe('invalidate with onlyIf: "rejected"', () => {
  it("retries the failed keys and leaves every other kind alone", async () => {
    const lane = createLane();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const loaded = vi.fn(async () => "loaded");

    await expect(readOrCreate(lane, ["broken"], failing)).rejects.toThrow(
      "offline",
    );
    await expect(readOrCreate(lane, ["fine"], loaded)).resolves.toEqual({
      revision: expect.any(Number),
      data: "loaded",
    });

    lane.invalidateAll(() => true, { onlyIf: "rejected" });

    // The failed key is empty again, so the next read runs its loader…
    const retried = vi.fn(async () => "recovered");
    await expect(readOrCreate(lane, ["broken"], retried)).resolves.toEqual({
      revision: expect.any(Number),
      data: "recovered",
    });
    expect(retried).toHaveBeenCalledTimes(1);

    // …and the one that never failed was not touched.
    await expect(readOrCreate(lane, ["fine"], loaded)).resolves.toEqual({
      revision: expect.any(Number),
      data: "loaded",
    });
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("does not touch a key serving stale data after a failed refresh", async () => {
    // Stale-on-error records the fallback's settlement, which is `fulfilled`, so
    // a key someone is still reading from is not "rejected" however its last
    // load went. That is what makes this safe to fire at a whole subtree.
    const lane = createLane();
    let fail = false;
    const loader = vi.fn(async () => {
      if (fail) {
        throw new Error("offline");
      }

      return "cached";
    });

    const unsubscribe = subscribe(lane, ["k"]);

    await expect(readOrCreate(lane, ["k"], loader)).resolves.toMatchObject({
      data: "cached",
    });

    fail = true;
    lane.invalidate(["k"]);
    await expect(readOrCreate(lane, ["k"], loader)).resolves.toMatchObject({
      data: "cached",
      refreshError: expect.any(Error),
    });
    expect(loader).toHaveBeenCalledTimes(2);

    lane.invalidateAll(() => true, { onlyIf: "rejected" });

    await expect(readOrCreate(lane, ["k"], loader)).resolves.toMatchObject({
      data: "cached",
    });
    expect(loader).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("does not restart a read that is still in flight", async () => {
    const lane = createLane();
    const loader = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 50)),
    );

    const unsubscribe = subscribe(lane, ["k"]);
    const inFlight = readOrCreate(lane, ["k"], loader);

    lane.invalidateAll(() => true, { onlyIf: "rejected" });

    await expect(inFlight).resolves.toMatchObject({ data: "slow" });
    expect(loader).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
