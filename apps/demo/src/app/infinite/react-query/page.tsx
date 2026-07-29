"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useMemo, useState } from "react";
import { LabChrome } from "../_lab/chrome";
import { DatasetControls, ServerKnobControls } from "../_lab/controls";
import { useDatasetMutations } from "../_lab/dataset";
import { LabLayout } from "../_lab/lab-layout";
import { RequestTimeline } from "../_lab/request-timeline";
import { useLabSettings } from "../_lab/settings";
import { feedParamsOf } from "../_lab/types";
import { CachedPagesCard, QueryCacheControls } from "./cache-panel";
import { FeedList } from "./feed-list";

/**
 * The TanStack Query variant of the infinite-scroll lab.
 *
 * It brings its own `QueryClient` — a fresh one per mount, deliberately not the
 * workspace demo's shared client from `app/react-query/get-query-client.ts`.
 * The lab wants a cache whose entire contents are the experiment, and a
 * full-page reload has to be a clean slate. Defaults are otherwise left alone,
 * so whatever the request log shows is stock behaviour.
 *
 * The devtools are mounted too — the lab's own panel is the measurement, but
 * being able to cross-check it against react-query's own view matters when a
 * finding is surprising.
 */
export default function ReactQueryInfiniteLabPage() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ReactQueryInfiniteLab />
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}

const SUMMARY =
  "TanStack Query v5 · useInfiniteQuery with getNextPageParam. One cache entry holds { pages, pageParams }; every cursor after the first is derived from the page before it.";

function ReactQueryInfiniteLab() {
  const { settings, update } = useLabSettings();
  const mutations = useDatasetMutations();
  const [staleTime, setStaleTime] = useState(0);

  // The query key is built from these, so keeping the object stable keeps the
  // key stable.
  const feed = useMemo(
    () => feedParamsOf(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.limit, settings.sort, settings.cursorMode],
  );

  return (
    <LabLayout
      chrome={<LabChrome variant="react-query" summary={SUMMARY} />}
      controls={
        <>
          <ServerKnobControls settings={settings} onChange={update} />
          <QueryCacheControls
            feed={feed}
            staleTime={staleTime}
            onStaleTimeChange={setStaleTime}
            mutations={mutations}
          />
          <DatasetControls mutations={mutations} />
        </>
      }
      main={
        settings.listMounted ? (
          <FeedList
            feed={feed}
            staleTime={staleTime}
            autoLoad={settings.autoLoad}
            mutations={mutations}
          />
        ) : (
          <section className="rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center">
            <p className="text-sm font-medium">The list is unmounted.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              No component is observing the query. Mutate the dataset or
              invalidate from here, then mount it again and watch the request log
              for what the remount does or does not fetch.
            </p>
          </section>
        )
      }
      sidebar={
        <>
          <CachedPagesCard feed={feed} />
          <RequestTimeline />
        </>
      }
    />
  );
}
