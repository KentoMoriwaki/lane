// @vitest-environment jsdom

/**
 * External reads: keys whose values arrive from outside the client — an RSC
 * payload through `<LaneHydration>`, a router's loader data — declared by giving
 * the read `loader: external` instead of a fetcher.
 *
 * `external` is a real loader, so nothing in the read paths branches on it. What
 * it does when it runs is wait: the promise is settled by being replaced, or it
 * rejects on the timeout so that a key nobody publishes fails loudly. Two
 * consequences follow from the entry knowing whose value it holds — the client
 * mutation surface throws on it, and its retention is delegated to reachability
 * (a `WeakRef`, tethered by the publication and by every committed reader)
 * instead of to `gcTime`.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import { setExternalRefFactory } from "../core";
import { readOrCreate } from "./test-utils";
import {
  createLane,
  external,
  laneRead,
  LaneExternalTimeoutError,
  LaneHydration,
  LaneOwnershipError,
  LaneProvider,
  useLane,
  useLanePromise,
} from "../index";
import { EXTERNAL_TIMEOUT } from "../external";
import { hydrateMany, publishedBy } from "../hydrate";
import type {
  Lane,
  LaneExternalReadSpec,
  LaneExternalResult,
  LaneGatedExternalResult,
  LaneHydrationSnapshots,
  LaneKeyOf,
  LaneRead,
  LaneReadSpec,
} from "../types";
import { resetVitest, settlePromiseHandlers, subscribe } from "./test-utils";

type Mode = "hidden" | "visible";

const roots: Root[] = [];

let fallbackRenders = 0;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }

  document.body.innerHTML = "";
  fallbackRenders = 0;
  setExternalRefFactory(undefined);
  resetVitest();
});

describe("the external wait", () => {
  it("waits instead of loading, and resolves with the publication", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    await flushMicrotasks();

    // The wait *was* the next publication of this key, so it settles with it
    // rather than being abandoned — the only thing a reader suspended on it can
    // be told, since it has no subscription to notify.
    expect(waiting.status).toBe("fulfilled");
    expect(waiting.value).toEqual({ revision: expect.any(Number), data: "published" });

    // And the store's own promise holds the same publication, so a reader that
    // retried and one that kept the old promise agree.
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });

    // The timeout that would have fired is gone with the wait it belonged to.
    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT * 2);
    await flushMicrotasks();

    expect(waiting.status).toBe("fulfilled");
  });

  it("leaves a client-owned read's abort exactly as it was", async () => {
    const lane = createLane();
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: { signal: AbortSignal }) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    void readOrCreate<string>(lane, ["task", "t1"], loader);
    await flushMicrotasks();

    // The publication channel rides the abort reason, and only an external
    // entry's abort carries one: a client loader still sees the plain
    // `AbortError` it has always seen when its read is superseded.
    lane.set(["task", "t1"], "published");

    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error | undefined)?.name).toBe("AbortError");
  });

  it("leaves a wait unsettled when it is stopped without a publication", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await flushMicrotasks();

    // An abort that carries no value has nothing to resolve with, so the wait is
    // dropped rather than settled — rejecting it would be an unhandled rejection
    // for a read the caller itself stopped. Its timer goes with it.
    lane.cancel(["task", "t1"]);
    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT * 2);
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
  });

  it("rejects with a timeout naming the key when nothing publishes it", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT - 1);
    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(waiting.status).toBe("rejected");
    expect(waiting.error).toBeInstanceOf(LaneExternalTimeoutError);
    expect((waiting.error as LaneExternalTimeoutError).keyId).toBe(
      '["task","t1"]',
    );
    expect((waiting.error as Error).message).toContain('["task","t1"]');
  });

  it("times out once, however many retries the read was given", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    // Not expressible through `laneRead<T>({ loader: external })` — the external
    // spec has no `retry`. A read written inline against the wider signature can
    // still ask, and a retry would only restart the clock on a key that is not
    // being published, so the wait ignores it.
    const waiting = track(
      readOrCreate<string>(lane, ["task", "t1"], external, {
        retry: 3,
        retryDelay: () => 0,
      }),
    );

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();

    expect(waiting.status).toBe("rejected");
    expect(waiting.error).toBeInstanceOf(LaneExternalTimeoutError);
  });

  it("lets a publication overwrite an entry the timeout left rejected", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();
    expect(waiting.status).toBe("rejected");

    // The failure is as sticky as any other failed first load — reused until
    // something replaces it, which for an external key means the publication
    // that was late rather than absent.
    const retried = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();
    expect(retried.status).toBe("rejected");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "late" }],
    });

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "late" });
  });
});

describe("ownership of an external entry", () => {
  it("refuses every client mutation on a key read as external", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    void readOrCreate<string>(lane, ["task", "t1"], external);

    expect(() => lane.set(["task", "t1"], "client")).toThrow(LaneOwnershipError);
    expect(() => lane.update<string>(["task", "t1"], (task) => task)).toThrow(
      LaneOwnershipError,
    );
    expect(() => lane.invalidate(["task", "t1"])).toThrow(LaneOwnershipError);
    expect(() => lane.remove(["task", "t1"])).toThrow(LaneOwnershipError);
  });

  it("refuses the scoped variants that match an external entry", () => {
    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    expect(() => lane.invalidateAll(["task"])).toThrow(LaneOwnershipError);
    expect(() => lane.updateAll<string>(["task"], (task) => task)).toThrow(
      LaneOwnershipError,
    );
    expect(() => lane.removeAll(["task"])).toThrow(LaneOwnershipError);
  });

  it("refuses a scoped write without half-applying it", async () => {
    const lane = createLane();

    lane.set(["task", "t1"], "client");
    hydrateMany(lane, {
      entries: [{ key: ["task", "t2"], data: "published" }],
    });

    expect(() => lane.updateAll<string>(["task"], () => "edited")).toThrow(
      LaneOwnershipError,
    );

    // The client-owned member of the scope is untouched: the whole operation was
    // refused, not the tail of it.
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], async () => "reloaded"),
    ).resolves.toEqual({ revision: expect.any(Number), data: "client" });
  });

  it("names the key and the operation", () => {
    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    expect(() => lane.set(["task", "t1"], "client")).toThrow(
      /\["task","t1"\][\s\S]*`set`/,
    );
  });

  it("refuses to prefetch an external read", () => {
    const lane = createLane();
    // Rejected by `prefetch`'s parameter type as well (see the type
    // expectations below); this is the cast that gets past it.
    const spec = laneRead<string>({ key: ["task", "t1"], loader: external });

    expect(() =>
      lane.prefetch(spec as unknown as LaneReadSpec<string>),
    ).toThrow(LaneOwnershipError);
  });

  it("leaves client-owned keys alone", () => {
    const lane = createLane();

    lane.set(["task", "t1"], "client");
    hydrateMany(lane, {
      entries: [{ key: ["task", "t2"], data: "published" }],
    });

    expect(() => lane.set(["task", "t1"], "edited")).not.toThrow();
    expect(() => lane.invalidate(["task", "t1"])).not.toThrow();
    expect(() => lane.remove(["task", "t1"])).not.toThrow();
  });

  // Seeding is a claim of ownership, so a key that is seeded and *also* read
  // with a client loader has two owners. The store settles that in the
  // publisher's favour and says nothing: the read runs, and what it produces is
  // held weakly with no `lastFulfilled` behind it, so the mistake surfaces
  // later — at a write that throws, or a value that quietly went missing. The
  // read is where both halves are visible, so the read is where it is reported.
  describe("a client loader on a published key", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns in development, naming the key", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "warns"], data: "published" }],
      });
      await readOrCreate(lane, ["seeded", "warns"], async () => "client");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('["seeded","warns"]');
      expect(warn.mock.calls[0]?.[0]).toContain("loader: external");
    });

    it("warns once for a key, not on every read of it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();
      const loader = async () => "client";

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "once"], data: "published" }],
      });
      // A reader re-reads on every notification and every reveal; one warning
      // per read would bury the console it is trying to reach.
      await readOrCreate(lane, ["seeded", "once"], loader);
      await readOrCreate(lane, ["seeded", "once"], loader);
      await readOrCreate(lane, ["seeded", "once"], loader);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays quiet for the combinations that are not a mistake", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "quiet"], data: "published" }],
      });

      // Reading a seeded key the declared way, and reading an *unseeded* key
      // with a client loader. Neither is two owners.
      await readOrCreate(lane, ["seeded", "quiet"], external);
      await readOrCreate(lane, ["client", "quiet"], async () => "client");

      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("retention of an external entry", () => {
  it("is exempt from the lane's own collection", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    // A client-owned key losing its last subscriber is what arms the lane-wide
    // sweep; the external entry is idle throughout and must survive it.
    subscribe(lane, ["__churn__"])();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });
  });

  it("serves a value that is still reachable", async () => {
    const lane = createLane();
    setExternalRefFactory(controllableRefs().factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });
  });

  it("reads a collected value as an absent one and waits again", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });

    // What a collection leaves behind: the shell, pointing at nothing. Both
    // states are correct by design, so a reader has to handle this one as
    // "not here" rather than as an error.
    refs.collect();

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    // And the key is filled by the same thing that filled it the first time.
    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "republished" }],
    });

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "republished" });
  });

  it("holds a client-owned entry strongly, whatever external entries do", async () => {
    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const loader = vi.fn(async () => "loaded");

    await readOrCreate(lane, ["task", "t1"], loader);
    refs.collect();

    await expect(readOrCreate(lane, ["task", "t1"], loader)).resolves.toEqual({ revision: expect.any(Number),
      data: "loaded",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("tethers what it published to the payload it came from", async () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [
        { key: ["task", "t1"], data: "one" },
        { key: ["task", "t2"], data: "two" },
      ],
    };

    hydrateMany(lane, snapshots);

    // The strong reference that keeps a published value alive for as long as
    // the framework holds the payload — the reason an external entry can afford
    // to hold it weakly.
    const tethered = publishedBy(snapshots);

    expect(tethered).toHaveLength(2);
    await expect(Promise.all(tethered ?? [])).resolves.toEqual([
      { revision: expect.any(Number), data: "one" },
      { revision: expect.any(Number), data: "two" },
    ]);
    expect(tethered?.[0]).toBe(
      readOrCreate<string>(lane, ["task", "t1"], external),
    );
  });
});

describe("an external reader", () => {
  it("shows the boundary's fallback until the key is published", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();

    await act(async () => {
      container.root.render(externalApp(lane));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("loading");

    // A reader that has not committed has no subscription to notify — but every
    // render attempt re-runs the `useState` initializer, so it reads whatever
    // the store holds by then. The publication lands, the tree re-renders, and
    // the read is the published value with no loader anywhere in sight.
    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    await act(async () => {
      container.root.render(externalApp(lane));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("published");
  });

  it("resolves in its own boundary when a publication elsewhere lands", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    // The outside reader: its own Suspense boundary, no hydration boundary above
    // it, so nothing re-renders it when the payload lands and it holds no
    // subscription to be notified through. The wait it suspended on is the only
    // channel that reaches it.
    await act(async () => {
      container.root.render(outsideReaderApp(lane, snapshots));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("loading");

    // Only as far as the publish macrotask — nowhere near the timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("server-1");
    expect(container.element.textContent).not.toContain("loading");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mounts on the seed a boundary above it published", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    // The boundary suspends until its publish has landed, so the reader's first
    // read is already the seed: no wait is ever created.
    expect(container.element.textContent).toBe("server-1");
  });

  it("converges on a republish while it is visible", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
  });

  it("reveals a republish that landed while hidden with no fallback", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "hidden"));
      await settlePromiseHandlers();
    });

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "hidden"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    const fallbacksBeforeReveal = fallbackRenders;

    // The reveal adopts the seed through the hydration source switch, in the
    // revealing render, so nothing loading is ever shown. This is where that
    // guarantee lives: `external` is what makes a reader a consumer of the
    // publication lineage at all, and a client-owned read of a seeded key
    // converges through the reveal reconciliation instead (see
    // activity.test.ts). The read *paths* still know nothing — the loader
    // decides who is woken, never how the entry is read.
    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "visible"));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
    expect(fallbackRenders).toBe(fallbacksBeforeReveal);
    expect(valueElement(container.element).style.display).toBe("");
  });

  it("drops to the fallback when the revealed value has been collected", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "hidden"));
      await settlePromiseHandlers();
    });

    // The store's copy is gone while the tree is hidden. The reader's own
    // committed promise is a strong reference in real life — this is the state
    // where the *store* has nothing to hand the reveal, which the layout
    // reconciliation turns into a fresh wait rather than a stale frame.
    refs.collect();

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("loading");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    });
    await act(async () => {
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
  });
});

/**
 * Type-level expectations. Never called — `pnpm typecheck` is what enforces
 * them, which is where the external read's shape is meant to fail: it carries no
 * option a loader would answer to, so writing one is an error at the definition.
 */
function typeExpectations(lane: Lane, enabled: boolean): void {
  type Task = { id: string; title: string };

  const detail = laneRead<Task>({ key: ["task", "t1"], loader: external });

  expectTypeOf(detail).toExtend<LaneExternalReadSpec<Task>>();
  // The key is tagged exactly as a client read's is, so the write side is
  // unchanged — and `T` travels to `useLane` through it.
  expectTypeOf(detail.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // No `invalidate`: an external entry is not the client's to converge. The
  // resolved value is the ordinary `LaneRead` — `revision` included, though on
  // an external entry it is the publication's identity rather than the
  // content's (see the type's docs).
  expectTypeOf(useLane(detail)).toEqualTypeOf<LaneExternalResult<Task>>();
  expectTypeOf(useLanePromise(detail)).toEqualTypeOf<Promise<LaneRead<Task>>>();

  const gated = laneRead<Task>({
    key: ["task", "t1"],
    loader: enabled ? external : undefined,
  });
  expectTypeOf(useLane(gated)).toEqualTypeOf<LaneGatedExternalResult<Task>>();
  expectTypeOf(gated.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // @ts-expect-error — freshness is a loader's business, and there is no loader.
  laneRead<Task>({ key: ["task", "t1"], loader: external, staleTime: 60_000 });
  // @ts-expect-error — same for every revalidation trigger,
  laneRead<Task>({ key: ["task", "t1"], loader: external, refetchOnMount: true });
  // @ts-expect-error — for retries,
  laneRead<Task>({ key: ["task", "t1"], loader: external, retry: 2 });
  // @ts-expect-error — and for what a loader would be handed.
  laneRead<Task>({ key: ["task", "t1"], loader: external, loaderMeta: undefined });

  // @ts-expect-error — prefetch runs a loader; this read is filled by its owner.
  lane.prefetch(detail);

  // The write side is closed at runtime, not in the key's type — a key literal
  // would slip past any brand, so there is nothing here to check.
  lane.set(detail.key, { id: "t1", title: "Write" });
}

void typeExpectations;

type Tracked<T> = {
  status: "pending" | "fulfilled" | "rejected";
  value: T | undefined;
  error: unknown;
};

/**
 * Observe a promise without awaiting it — a wait that never settles is the
 * normal state here, so "still pending" has to be assertable.
 */
function track<T>(promise: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = {
    error: undefined,
    status: "pending",
    value: undefined,
  };

  promise.then(
    (value) => {
      tracked.status = "fulfilled";
      tracked.value = value;
    },
    (error: unknown) => {
      tracked.status = "rejected";
      tracked.error = error;
    },
  );

  return tracked;
}

async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

/**
 * The `WeakRef` stand-in: a reference the test can kill on demand. Collection is
 * not schedulable, but "the value is gone" is a state the store has to serve
 * correctly, and this is the only way to be at that moment on purpose.
 */
function controllableRefs() {
  const refs: { collected: boolean }[] = [];

  return {
    collect() {
      for (const ref of refs) {
        ref.collected = true;
      }
    },
    factory: <T extends object>(value: T) => {
      const ref = { collected: false };
      refs.push(ref);

      return { deref: () => (ref.collected ? undefined : value) };
    },
  };
}

function Probe({ spec }: { spec: LaneExternalReadSpec<string> }) {
  const { promise } = useLane(spec);

  return React.createElement(
    "div",
    { "data-testid": "value" },
    React.use(promise).data,
  );
}

function Fallback() {
  fallbackRenders += 1;

  return React.createElement("span", null, "loading");
}

const taskRead = laneRead<string>({ key: ["task", "t1"], loader: external });

function externalApp(lane: Lane): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: React.createElement(Fallback) },
      React.createElement(Probe, { spec: taskRead }),
    ),
  });
}

/**
 * A reader with no publication above it, in a boundary of its own, beside a
 * hydration boundary that seeds its key. Nothing connects the two but the store.
 */
function outsideReaderApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(Probe, { spec: taskRead }),
      ),
      React.createElement(
        React.Suspense,
        { fallback: React.createElement("span", null, "publishing") },
        React.createElement(LaneHydration, {
          children: React.createElement("span", null, ""),
          snapshots,
        }),
      ),
    ),
  });
}

function hydratedExternalApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
  mode: Mode,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(LaneHydration, {
          children: React.createElement(Probe, { spec: taskRead }),
          snapshots,
        }),
      ),
      mode,
    }),
  });
}

function mount(): { element: HTMLDivElement; root: Root } {
  const element = document.createElement("div");
  const root = createRoot(element);

  document.body.append(element);
  roots.push(root);

  return { element, root };
}

function valueElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="value"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("Missing the probe's value element");
  }

  return element;
}
