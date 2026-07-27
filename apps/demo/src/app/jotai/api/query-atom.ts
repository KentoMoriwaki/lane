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

export function queryAtom<Value>(
  scopeAtom: Atom<string>,
  load: (get: Getter) => Promise<Value>,
): QueryAtom<Value> {
  const sourceAtom = atomWithRefresh((get) => {
    // Reading the scope here is what binds the fetch to the session and team:
    // it re-runs on its own when either changes, refresh action or not.
    get(scopeAtom);
    return load(get);
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

      // `update` needs the value that is on screen. If the entry is still
      // loading, chain onto its promise rather than dropping the patch — the
      // reader keeps suspending and sees the patched result when it lands.
      const current = get(entryAtom);
      set(overlayAtom, {
        scope,
        value:
          current instanceof Promise
            ? current.then(action.updater)
            : action.updater(current),
      });
    },
  );

  return entryAtom;
}
