import { serializeKey } from "./keys";
import { isPublication, markExternalLoader } from "./ownership";
import type { LaneExternalLoader, LaneKey, LaneLoaderContext } from "./types";

/**
 * How long an external read waits for its publication before rejecting: an
 * unpublished key must fail in-session instead of hanging as a fallback.
 */
export const EXTERNAL_TIMEOUT = 10_000;

/** Rejection when no publication arrived in time; carries the key. */
export class LaneExternalTimeoutError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, timeout: number) {
    const keyId = serializeKey(key);

    super(
      // Diagnosis in dev, identification in prod — see `LaneOwnershipError`
      // for why the condition wraps the literal directly.
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
 * Loader for a value the client does not fetch (RSC payload via
 * `<LaneHydration>`, router loader data): `laneRead<Task>({ key, loader: external })`.
 * A real loader by design, so every read path stays one unconditional
 * `readOrCreate`.
 *
 * It resolves with the **next publication of the key** — React only retries a
 * suspended render when the promise it suspended on settles, so the value must
 * arrive through this promise; the store delivers it via the abort it fires
 * when replacing the read ({@link publicationReason}). After
 * {@link EXTERNAL_TIMEOUT} it rejects with {@link LaneExternalTimeoutError}.
 * A non-publication abort (cancel, eviction) leaves the promise unsettled —
 * rejecting a discarded read would be an unhandled rejection. It never falls
 * back to fetching: that would be the ownership violation it exists to remove.
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

    // Whichever end arrives first takes the wait off the other.
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }

    // A publication abort carries the value being installed; any other abort
    // carries none, so the promise is dropped unsettled.
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
