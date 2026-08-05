import { serializeKey } from "./keys";
import { isPublication, markExternalLoader } from "./ownership";
import type { LaneExternalLoader, LaneKey, LaneLoaderContext } from "./types";

/**
 * How long an external read waits for its publication before failing.
 *
 * Long enough that no real publication path — an RSC payload still streaming, a
 * router loader mid-flight — is cut short, and short enough that a key nobody
 * publishes fails inside a session rather than hanging as a permanent fallback.
 * The failure is the point: an external read that waits forever is a typo or a
 * missing boundary, and silence is the worst way to report either.
 */
export const EXTERNAL_TIMEOUT = 10_000;

/**
 * What an external read rejects with when no publication arrived. It names the
 * key because that is the whole diagnosis — either nothing publishes it, or what
 * publishes it spells it differently.
 */
export class LaneExternalTimeoutError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, timeout: number) {
    const keyId = serializeKey(key);

    super(
      // Development gets the diagnosis, production gets the identification —
      // see `LaneOwnershipError` for why the condition is spelled out here
      // rather than factored into a helper.
      typeof process !== "undefined" && process.env.NODE_ENV !== "production"
        ? `No publication arrived for ${keyId} within ${timeout}ms. A read ` +
            "with `loader: external` waits for its owner to publish the key — " +
            "check that a `<LaneHydration>` boundary (or whatever publishes " +
            "this lane) seeds exactly this key."
        : `No publication arrived for ${keyId} within ${timeout}ms.`,
    );

    this.name = "LaneExternalTimeoutError";
    this.key = key;
    this.keyId = keyId;
  }
}

/**
 * The loader for a value **the client does not fetch**: an RSC payload seeded
 * through `<LaneHydration>`, a router's loader data — anything whose truth lives
 * outside the browser session and arrives as a publication.
 *
 * ```ts
 * export const taskLanes = {
 *   detail: (id: string) => laneRead<Task>({ key: ["task", id], loader: external }),
 * };
 * ```
 *
 * **It is a real loader, and that is the design.** The alternative — a second
 * read function, or a flag every read path has to test — would put a branch in
 * `useLane`'s `useState` initializer, its source switch, its reveal
 * reconciliation, and its subscribe catch-up, all to express something the loader
 * slot already says. So the slot carries three values instead: a function is
 * client-owned, `external` is published from outside, `undefined` is disabled.
 * Every read path stays one unconditional `readOrCreate`.
 *
 * `useLane` does ask which it was handed, once, and not on a read path: whether
 * to observe the publication lineage at all. That is a question about *ownership*
 * rather than about how to read — only a key somebody else fills has a
 * publication to wait for — so the loader slot is exactly where the answer lives.
 *
 * What it does when it runs is wait, and what it resolves with is **the next
 * publication of this key**. That is the literal reading of the promise, and it
 * is what makes a reader that has not committed yet work: it has no subscription
 * to notify, and React only retries a suspended render when the promise it
 * suspended on settles — so the publication has to reach it through that promise
 * or not at all. The store hands the value over on the abort it already fires
 * when it replaces the read ({@link publicationReason}), the timer is dropped,
 * and the reader retries into a store that already holds the value.
 *
 * The timeout is the other end: {@link EXTERNAL_TIMEOUT} with no publication
 * rejects with a {@link LaneExternalTimeoutError} naming the key, because a read
 * nobody publishes should fail loudly rather than suspend forever. A wait that is
 * merely aborted without a publication — the entry evicted, a read cancelled —
 * clears its timer and stays unsettled deliberately: there is no value to give
 * it, and rejecting a read something else discarded would be an unhandled
 * rejection nobody is left to catch.
 *
 * It never fetches, and there is no fallback that would. A loader reached after
 * the timeout would be exactly the ownership violation this exists to remove: the
 * client picking up a vintage its owner does not know about.
 */
const externalLoader = (
  context: LaneLoaderContext<unknown>,
): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    const { key, signal } = context;

    const timer = setTimeout(() => {
      done();
      reject(new LaneExternalTimeoutError(key, EXTERNAL_TIMEOUT));
    }, EXTERNAL_TIMEOUT);

    // Whichever end arrives first takes the wait off the other, so the timeout
    // can never reject a publication that already landed, and an abort can never
    // settle a wait that already timed out.
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }

    // The store aborts this read when it replaces the entry, and *why* it is
    // replacing decides what the wait was: a publication carries the value it is
    // installing, so the wait ends as the read it always was. Any other abort —
    // a cancel, an eviction — carries no value, so there is nothing honest to
    // settle with and the promise is dropped instead (rejecting a read something
    // else discarded would be an unhandled rejection with no reader left).
    function onAbort(): void {
      const { reason } = signal;

      done();

      if (isPublication(reason)) {
        resolve(reason.value);
      }
    }

    signal.addEventListener("abort", onAbort);
  });

export const external = markExternalLoader(
  externalLoader,
) as unknown as LaneExternalLoader;
