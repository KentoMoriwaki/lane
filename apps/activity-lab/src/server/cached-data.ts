import { nextValue } from "./bfcache-data";

// The version counter only advances when this function body actually runs, so
// the value itself reports cache hits: a revisit that serves the cache shows
// the same vN, a miss shows vN+1.
export async function cachedValue(name: string): Promise<string> {
  "use cache";
  return nextValue(`cached-${name}`, "rsc");
}
