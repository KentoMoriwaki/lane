import type { LaneKey } from "./types";

/**
 * What a failed read throws — the loader's error wrapped in one that says *which
 * key* failed.
 *
 * A read that fails with nothing to show throws, which unmounts the reader that
 * was suspended on it. In the common shape — `useLane` and `use` in the same
 * component, under the boundary — that reader was also the only thing holding
 * the key: the subscription and the `invalidate` the hook handed it go with it.
 * The error is the one artifact that crosses the boundary from a reader that no
 * longer exists, so it is what carries the key out:
 *
 * ```tsx
 * function Fallback({ error, clear }: { error: unknown; clear: () => void }) {
 *   const lane = useLaneInstance();
 *
 *   if (!(error instanceof LaneReadError)) {
 *     throw error;   // not ours to recover
 *   }
 *
 *   return (
 *     <button onClick={() => { lane.invalidate(error.key); clear(); }}>
 *       Retry
 *     </button>
 *   );
 * }
 * ```
 *
 * The instance is deliberately *not* carried here, and neither is a `retry()`
 * method. The lane is a context read away for anything that can call a hook (a
 * fallback is a component), and a method would have to answer questions the
 * error has no business answering — invalidate or remove, and whether it also
 * clears the boundary's own state. A key answers nothing and composes with
 * everything.
 *
 * **Only a client-owned read is wrapped.** A published key is not the client's
 * to invalidate or remove — the store throws {@link LaneOwnershipError} on both —
 * so an external failure would be handing out a recovery that cannot be
 * performed. Those keep their own shape ({@link LaneExternalTimeoutError}, which
 * carries the same `key` for identification).
 *
 * **The `error` on a resolved read is not wrapped.** That field reaches a reader
 * that is still mounted and still holds its own `invalidate`; nothing was lost,
 * so nothing needs carrying. The wrapper is for the case where the error is all
 * that survived — which is also why a read whose `fallback` returned a value
 * never produces one, and a policy that *throws* does.
 *
 * **It does not survive the server.** React replaces an error thrown while
 * rendering on the server with a digest before the client sees it, so a fallback
 * recovering by `error.key` recovers from client-side failures only. A read that
 * failed during SSR reaches the browser as an ordinary error, and the boundary
 * needs the app's own way back.
 */
export class LaneReadError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, keyId: string, cause: unknown) {
    // The cause's own message is part of this one rather than only reachable
    // through `cause`, because the wrapper is what gets logged, and an error
    // that says a key failed without saying how is worse than the error it
    // replaced.
    const detail = messageOf(cause);

    super(
      // Development gets the diagnosis, production gets the identification —
      // see `LaneOwnershipError` for why the condition is spelled out here
      // rather than factored into a helper.
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

/**
 * A rejection is not necessarily an `Error` — `Promise.reject("nope")` and a
 * bare `reject()` are both a loader away. That is also the argument for wrapping
 * rather than tagging: there is nothing to hang a property on.
 */
function messageOf(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return typeof cause === "string" ? cause : String(cause);
}
