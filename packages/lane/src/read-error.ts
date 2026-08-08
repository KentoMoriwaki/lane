import type { LaneKey } from "./types";

/**
 * What a failed read throws: the loader's error wrapped in one that names
 * *which key* failed (`cause` is the loader's own error).
 *
 * The throw unmounts the suspended reader — typically the only holder of the
 * key's subscription and `invalidate` — so the error is what carries the key
 * across the boundary; a fallback recovers with `lane.invalidate(error.key)`.
 * No lane instance or `retry()` is carried: a key answers no policy questions
 * and composes with everything.
 *
 * Only a client-owned read is wrapped: a published key is not the client's to
 * invalidate ({@link LaneOwnershipError}), so external failures keep their own
 * shape ({@link LaneExternalTimeoutError}, same `key` field). The `error` on a
 * *resolved* read is not wrapped either — that reader is still mounted with its
 * own `invalidate`. And it does not survive SSR: React digests server render
 * errors, so `error.key` recovery is client-side only.
 */
export class LaneReadError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, keyId: string, cause: unknown) {
    // The cause's message is inlined because the wrapper is what gets logged.
    const detail = messageOf(cause);

    super(
      // Diagnosis in dev, identification in prod — see `LaneOwnershipError`
      // for why the condition wraps the literal directly.
      typeof process !== "undefined" && process.env.NODE_ENV !== "production"
        ? `Reading ${keyId} failed: ${detail}. The rejection is cached, so ` +
            "every later read of the key throws it too, until the key is " +
            "invalidated, removed, or collected. To recover from an error " +
            "boundary without knowing what it was reading, invalidate " +
            "`error.key`; the loader's own error is `error.cause`."
        : `Reading ${keyId} failed: ${detail}`,
      { cause },
    );

    this.name = "LaneReadError";
    this.key = key;
    this.keyId = keyId;
  }
}

// A rejection need not be an Error (`Promise.reject("nope")`) — also why we
// wrap rather than tag: there may be nothing to hang a property on.
function messageOf(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return typeof cause === "string" ? cause : String(cause);
}
