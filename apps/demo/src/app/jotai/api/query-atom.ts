import { atom, type Atom, type Getter, type WritableAtom } from "jotai";
import { atomWithRefresh } from "jotai/utils";

/**
 * The one cache primitive this variant is built on.
 *
 * jotai has no query cache: an atom that returns a promise *is* the cache
 * entry, and `useAtomValue` unwraps it with `use`, so Suspense and transitions
 * come from React rather than from a status object. What a fetching library
 * adds on top of that is a way to (a) throw the cached value away and read
 * again, and (b) publish a value you already hold without a round trip. This
 * factory adds exactly those two, and nothing else.
 *
 * - `{ type: "refresh" }` re-runs the loader — `atomWithRefresh`'s whole job.
 * - `{ type: "set" }` / `{ type: "update" }` write into an *overlay* that
 *   shadows the fetched value until the next refresh clears it. That is how a
 *   mutation response lands in a list without refetching it.
 *
 * Every entry is stamped with the scope it was read under. The scope is an
 * ordinary derived atom (session + active team), so it is a real dependency of
 * the loader: change teams and every read re-runs, and any overlay written
 * under the old scope stops applying instead of leaking across the switch.
 * There is no cache-eviction API to call — the dependency graph does it.
 */
export type QueryAction<Value> =
  | { type: "refresh" }
  | { type: "set"; value: Value }
  | { type: "update"; updater: (value: Value) => Value };

export type QueryAtom<Value> = WritableAtom<
  Value | Promise<Value>,
  [QueryAction<Value>],
  void
>;

type Overlay<Value> = {
  scope: string;
  value: Value | Promise<Value>;
};

/**
 * A promise that remembers what it settled to.
 *
 * `get` hands back the entry's promise whether or not it has resolved, so
 * patching a list that is already on screen would otherwise have to be
 * `promise.then(updater)` — a brand new *pending* promise, which `use` has no
 * choice but to suspend on. The reader would drop to its skeleton in order to
 * show data it already had, and the "patch in place, don't refetch" path would
 * look worse than the refetch it was avoiding. Remembering the settled value
 * lets the patch be applied synchronously instead.
 */
type TrackedPromise<Value> = Promise<Value> & {
  settled?: { value: Value };
};

function trackSettled<Value>(promise: Promise<Value>): TrackedPromise<Value> {
  const tracked: TrackedPromise<Value> = promise;
  promise.then(
    (value) => {
      tracked.settled = { value };
    },
    () => {
      // A rejected read has no value to patch. The reader's error boundary owns
      // it; swallowing here only keeps this bookkeeping chain from being an
      // unhandled rejection of its own.
    },
  );
  return tracked;
}

function patch<Value>(
  current: Value | Promise<Value>,
  updater: (value: Value) => Value,
): Value | Promise<Value> {
  if (!(current instanceof Promise)) {
    return updater(current);
  }

  const settled = (current as TrackedPromise<Value>).settled;
  if (settled) {
    return updater(settled.value);
  }

  // Still loading: chain onto the promise rather than dropping the patch. The
  // reader keeps suspending — correctly, it has nothing to show yet — and sees
  // the patched result when it lands.
  return trackSettled(current.then(updater));
}

export function queryAtom<Value>(
  scopeAtom: Atom<string>,
  load: (get: Getter) => Promise<Value>,
): QueryAtom<Value> {
  const sourceAtom = atomWithRefresh((get) => {
    // Reading the scope here is what binds the fetch to the session and team:
    // it re-runs on its own when either changes, refresh action or not.
    get(scopeAtom);
    return trackSettled(load(get));
  });

  const overlayAtom = atom<Overlay<Value> | null>(null);

  const entryAtom: QueryAtom<Value> = atom(
    (get) => {
      const overlay = get(overlayAtom);
      return overlay && overlay.scope === get(scopeAtom)
        ? overlay.value
        : get(sourceAtom);
    },
    (get, set, action) => {
      if (action.type === "refresh") {
        // Locally published data is a claim about the *previous* response, so
        // it cannot outlive the read that replaces it.
        set(overlayAtom, null);
        set(sourceAtom);
        return;
      }

      const scope = get(scopeAtom);

      if (action.type === "set") {
        set(overlayAtom, { scope, value: action.value });
        return;
      }

      // `update` needs the value that is on screen, which `patch` takes from
      // the entry without going back to a pending state for data it already
      // holds.
      set(overlayAtom, { scope, value: patch(get(entryAtom), action.updater) });
    },
  );

  return entryAtom;
}
