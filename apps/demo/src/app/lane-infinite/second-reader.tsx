"use client";

import * as React from "react";
import { useInfiniteLane } from "use-lane";
import type { TaskPage } from "@/server/api";
import { fetchTaskPage, type TaskPageFilters } from "./api/endpoints";
import { taskListKey } from "./api/lane-reads";
import { recordProbe } from "./probe";

/**
 * **A second reader of the same key**, and the one thing the interim pattern
 * cannot hide.
 *
 * The hybrid hook holds the new first page in *component state* until its effect
 * resets the entry. So for the length of that window this component — which
 * reads the same key with no knowledge of any of it — is still showing the list
 * the previous first page anchored. The two disagree, on screen, for as long as
 * the window lasts.
 *
 * That is normally a frame or two and invisible. `?adoptDelay=1200` makes it
 * long enough to read, which is the point of having this here: the window is a
 * real property of the pattern, not an artefact, and a screen with two readers
 * of one list has to know it exists. The core version of this feature did not
 * have it — an entry-level version let the store converge every reader at once.
 *
 * Its loader is a real fetch, deliberately. If it ever runs for page 1 the probe
 * records a page-1 network request, which is exactly the failure worth catching:
 * it would mean the entry was empty when this reader arrived.
 */
export function SecondReader({ filters }: { filters: TaskPageFilters }) {
  const { promise } = useInfiniteLane<TaskPage, string | null>({
    key: taskListKey(filters),
    initialCursor: null,
    fetchPage: async (cursor, { meta, signal }) => {
      const page = await fetchTaskPage(meta, filters, { cursor }, signal);
      recordProbe("network", cursor, page);
      return page;
    },
    nextCursor: (page) => page.nextCursor,
  });
  const { data } = React.use(promise);
  const first = data.pages[0];

  return (
    <span
      data-testid="second-reader"
      data-second-depth={data.pages.length}
      data-second-seq={first?.serveSeq ?? ""}
      className="rounded border border-dashed px-2 py-1 font-mono text-xs text-muted-foreground"
    >
      second reader of the key · {data.pages.length} page(s) · page 1 seq{" "}
      {first?.serveSeq ?? "—"}
    </span>
  );
}
