import type { LaneKey, LaneLoaderContext } from "use-lane";
import type { SearchResponse } from "@/server/search/schema";
import { labSearch } from "./_lab/search-client";

/**
 * One key per topic, switched by clicking.
 *
 * Deliberately not a search field. Debouncing decides *how often* the key moves
 * and is orthogonal to what happens to the read left behind *when* it does — and
 * driving the key from a text field makes that moment depend on typing speed
 * against latency, which is a timing puzzle rather than a measurement. A button
 * makes it exact.
 */
export function searchKey(topic: string): LaneKey {
  return ["search", topic];
}

export function searchLoader(
  topic: string,
): (context: LaneLoaderContext) => Promise<SearchResponse> {
  return ({ signal }) => labSearch(topic, signal);
}
