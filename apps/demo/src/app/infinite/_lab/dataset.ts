"use client";

import { useCallback, useState } from "react";
import type { FeedItem } from "@/server/feed/schema";
import {
  deleteFeedItem,
  prependFeedItem,
  resetFeedDataset,
  updateFeedItem,
} from "./feed-client";

/**
 * Server-side edits to the dataset: insert at the head, rename a row, delete a
 * row, reset to the generated seed.
 *
 * These are plain HTTP calls with no library involved — nothing here knows or
 * cares what is caching the list. Deliberately, none of them notify a cache:
 * the whole point of the lab is to decide *when* to refetch and watch what that
 * costs, so telling the client about the write would remove the experiment.
 */
export function useDatasetMutations() {
  const [busy, setBusy] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, task: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);

      try {
        await task();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
        setBusyItemId(null);
      }
    },
    [],
  );

  const prepend = useCallback(
    () => run("Inserting a row at the head", () => prependFeedItem()),
    [run],
  );

  const rename = useCallback(
    (item: FeedItem) => {
      setBusyItemId(item.id);
      return run(`Renaming ${item.id}`, () =>
        updateFeedItem(item.id, editedTitle(item.title)),
      );
    },
    [run],
  );

  const remove = useCallback(
    (item: FeedItem) => {
      setBusyItemId(item.id);
      return run(`Deleting ${item.id}`, () => deleteFeedItem(item.id));
    },
    [run],
  );

  const reset = useCallback(
    () => run("Resetting the dataset", resetFeedDataset),
    [run],
  );

  return { busy, busyItemId, error, run, prepend, rename, remove, reset };
}

/** Readable after repeated edits, and obvious at a glance that it changed. */
function editedTitle(title: string): string {
  const base = title.replace(/ · edited .*$/, "");
  const stamp = new Date().toLocaleTimeString(undefined, { hour12: false });
  return `${base.slice(0, 120)} · edited ${stamp}`;
}
