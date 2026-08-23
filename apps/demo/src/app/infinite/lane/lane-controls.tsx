"use client";

import { useLaneInstance } from "use-lane";
import { Button } from "@/components/ui/button";
import {
  ControlGroup,
  ControlRow,
  NumberSelect,
} from "../_lab/controls";
import type { useDatasetMutations } from "../_lab/dataset";
import { prependFeedItem } from "../_lab/feed-client";
import type { FeedParams } from "../_lab/types";
import { feedKey } from "./feed-lane";

/**
 * Convergence controls, which in lane means the `Lane` instance.
 *
 * These sit outside the list subtree so they keep working while it is
 * unmounted — `useLaneInstance()` is available anywhere under the provider,
 * with or without a reader.
 *
 * What is missing compared to the react-query panel is a cache *inspector*:
 * lane exposes no way to look at an entry's value without becoming a reader of
 * it (`prefetch` would start a load, which is not a look). So there is no
 * "pages currently cached" number here — the honest way to find out what
 * survived is the request log: mount the list and count the requests.
 */
export function LaneCacheControls({
  feed,
  refetchOnMount,
  onRefetchOnMountChange,
  mutations,
}: {
  feed: FeedParams;
  refetchOnMount: boolean;
  onRefetchOnMountChange: (value: boolean) => void;
  mutations: ReturnType<typeof useDatasetMutations>;
}) {
  const lane = useLaneInstance();
  const key = feedKey(feed);

  return (
    <ControlGroup
      title="Lane convergence"
      note="One key holds the whole accumulated list; the depth is in the value, and an invalidate reads the first page again. Operated through the Lane instance."
    >
      <ControlRow
        label="refetchOnMount"
        note={
          "Whether mounting a reader over a cached value triggers a background re-read. Gated on the read's staleTime (5s here) — a value younger than that is not re-read, however often you remount."
        }
      >
        <NumberSelect
          value={refetchOnMount ? 1 : 0}
          options={[0, 1]}
          format={(value) => (value === 0 ? "off" : "on")}
          onChange={(value) => onRefetchOnMountChange(value === 1)}
        />
      </ControlRow>

      <ControlRow
        label="Invalidate the whole list"
        note="Drops the cached promise and re-runs the loader; count the bars it produces and whether they start together or one after the other."
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => lane.invalidate(key)}
        >
          Invalidate
        </Button>
      </ControlRow>

      <ControlRow
        label="Insert a row, then invalidate"
        note="Compare the row at each page boundary before and after, and watch the duplicate / skipped counters above the list."
      >
        <Button
          size="xs"
          variant="outline"
          disabled={mutations.busy !== null}
          onClick={() =>
            void mutations.run("Inserting a row at the head", async () => {
              await prependFeedItem();
              lane.invalidate(key);
            })
          }
        >
          Prepend + invalidate
        </Button>
      </ControlRow>

      <ControlRow
        label="Remove the entry"
        note="Urgent, not a transition: a mounted reader drops the removed promise immediately instead of holding the old value."
      >
        <Button size="xs" variant="outline" onClick={() => lane.remove(key)}>
          Remove
        </Button>
      </ControlRow>
    </ControlGroup>
  );
}

/**
 * The sidebar counterpart of react-query's cached-pages card — except there is
 * nothing to read. Stated plainly rather than left as an empty space, because
 * "the cache is not inspectable from outside a reader" is itself one of the
 * things this lab is here to surface.
 */
export function LaneCacheCard() {
  return (
    <section className="rounded-xl border bg-card p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide">
        Lane cache
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Lane has no read-without-subscribe API, so there is no page count to show
        here while the list is unmounted.
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Mount the list and count the requests below: none means the value came
        from the cache.
      </p>
    </section>
  );
}
