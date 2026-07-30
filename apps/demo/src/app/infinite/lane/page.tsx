"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { LaneProvider, useLaneInstance } from "use-lane";
import { NO_SESSION } from "@/lib/lane-meta";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LabChrome } from "../_lab/chrome";
import { DatasetControls, ServerKnobControls } from "../_lab/controls";
import { useDatasetMutations } from "../_lab/dataset";
import { LabLayout } from "../_lab/lab-layout";
import { RequestTimeline } from "../_lab/request-timeline";
import { useLabSettings } from "../_lab/settings";
import { feedParamsOf } from "../_lab/types";
import { InitialLoadBoundary } from "./error-boundary";
import { feedKey } from "./feed-lane";
import { FeedList } from "./feed-list";
import { LaneCacheCard, LaneCacheControls } from "./lane-controls";

/**
 * The use-lane variant of the infinite-scroll lab.
 *
 * Its own `LaneProvider`, so the cache is the experiment and a reload is a clean
 * slate — the counterpart of the react-query page's fresh `QueryClient`.
 *
 * The boundaries are the interesting part of this file. React owns loading and
 * failure here, so they are structural rather than branches inside the list:
 * `<Suspense>` renders the skeleton for a first load with nothing to show, and
 * `<InitialLoadBoundary>` catches a first load that rejects. Neither is reached
 * again once the key has a value — after that a re-read holds the committed list
 * on screen through a transition, and a failed re-read comes back as
 * `refreshError` inside the list.
 */
export default function LaneInfiniteLabPage() {
  return (
    <LaneProvider loaderMeta={NO_SESSION}>
      <LaneInfiniteLab />
    </LaneProvider>
  );
}

const SUMMARY =
  "use-lane · useInfiniteLane. One key holds the whole accumulated list; the page depth is read back out of the cached value, load-more is a lane.update, and a re-read walks the cursor chain from the start.";

function LaneInfiniteLab() {
  const { settings, update } = useLabSettings();
  const mutations = useDatasetMutations();
  const lane = useLaneInstance();
  const [refetchOnMount, setRefetchOnMount] = useState<boolean | "always">(
    false,
  );

  const feed = useMemo(
    () => feedParamsOf(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.limit, settings.sort, settings.cursorMode],
  );
  const keyId = JSON.stringify(feed);

  /**
   * The read is held back until after mount, and this is a lane-specific need.
   *
   * `useLane` starts its load **during render**, which includes the server
   * render of this client component — and the lab's instrumented client fetches
   * a relative URL (`/api/feed/…`), which Node cannot parse. Without this gate
   * the server render of the list throws and React reports "switched to client
   * rendering because the server rendering errored", doing the whole render
   * twice for nothing. The react-query variant never hits it because
   * `useInfiniteQuery` fetches from an effect, so its loader simply does not run
   * on the server.
   *
   * Everything measured happens in the browser either way; this only stops the
   * wasted server attempt.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <LabLayout
      chrome={<LabChrome variant="lane" summary={SUMMARY} />}
      controls={
        <>
          <ServerKnobControls settings={settings} onChange={update} />
          <LaneCacheControls
            feed={feed}
            refetchOnMount={refetchOnMount}
            onRefetchOnMountChange={setRefetchOnMount}
            mutations={mutations}
          />
          <DatasetControls mutations={mutations} />
        </>
      }
      main={
        !mounted ? (
          <FeedSkeleton />
        ) : settings.listMounted ? (
          <InitialLoadBoundary
            resetKey={keyId}
            fallback={(error, retry) => (
              <section className="space-y-3 rounded-xl border border-rose/40 bg-rose/5 p-6 text-center">
                <p className="text-sm font-medium text-rose">
                  {error instanceof Error ? error.message : String(error)}
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  The first page had nothing to fall back to, so the read
                  rejected and this boundary caught it. Resetting alone re-reads
                  the same rejected promise — the entry has to be invalidated
                  first.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    lane.invalidate(feedKey(feed));
                    retry();
                  }}
                >
                  Invalidate and retry
                </Button>
              </section>
            )}
          >
            <Suspense fallback={<FeedSkeleton />}>
              <FeedList
                feed={feed}
                autoLoad={settings.autoLoad}
                loadMoreBurst={settings.loadMoreBurst}
                refetchOnMount={refetchOnMount}
                mutations={mutations}
              />
            </Suspense>
          </InitialLoadBoundary>
        ) : (
          <section className="rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center">
            <p className="text-sm font-medium">The list is unmounted.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Nothing is reading the key. Mutate the dataset or invalidate from
              here, then mount it again and watch the request log for what the
              remount does or does not fetch — and for how deep it comes back.
            </p>
          </section>
        )
      }
      sidebar={
        <>
          <LaneCacheCard />
          <RequestTimeline />
        </>
      }
    />
  );
}

function FeedSkeleton() {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Accumulated list</h2>
        <span className="text-[11px] text-muted-foreground">
          suspended — this is the Suspense fallback, shown only when there is no
          value yet
        </span>
      </div>
      <div className="space-y-3 rounded-lg border bg-surface p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
