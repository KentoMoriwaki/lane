"use client";

import {
  Suspense,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { LaneProvider, useLaneInstance } from "use-lane";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ControlGroup,
  ControlRow,
  Toggle,
  TransportControls,
} from "./_lab/controls";
import { LabLayout } from "./_lab/lab-layout";
import { RequestTimeline } from "./_lab/request-timeline";
import { setTransportKnobs } from "./_lab/search-client";
import { DEFAULT_SETTINGS, type CancelLabSettings } from "./_lab/types";
import { FirstLoadBoundary } from "./error-boundary";
import { SearchResults } from "./results";
import { searchKey } from "./search-lane";

/**
 * The cancel lab.
 *
 * Its own `LaneProvider`, so the cache is the experiment and a reload is a clean
 * slate.
 *
 * The key is switched by clicking, not by typing. Debouncing is orthogonal to
 * the question — it decides *how often* the key moves, and what is being
 * measured here is what happens to the read left behind *when* it moves. A
 * button makes that moment exact: click one topic, click another while the first
 * is still in flight, and the read for the first has been superseded with no
 * timing to get right.
 *
 * React never reports that the render which started that read was thrown away.
 * Nothing cancels it unless something asks, and the only place that knows which
 * key was left behind is the handler that moved off it.
 */
export default function CancelLabPage() {
  return (
    <LaneProvider>
      <CancelLab />
    </LaneProvider>
  );
}

const SUMMARY =
  "use-lane · lane.cancel. Switch keys by clicking, with the latency knob long enough that the read left behind is always still in flight. Watch the request log for what keeps running, and the results heading for what each key holds afterwards.";

/** Topics the server's dataset actually has, so each key returns its own rows. */
const TOPICS = [
  "billing",
  "onboarding",
  "scheduler",
  "webhooks",
  "analytics",
  "importer",
] as const;

function CancelLab() {
  const lane = useLaneInstance();
  const [settings, setSettings] = useState<CancelLabSettings>(DEFAULT_SETTINGS);

  /**
   * Two keys, and telling them apart is most of the point.
   *
   * `committed` moves in a transition, so it lags: it names the key whose rows
   * are on screen. `clicked` is an optimistic overlay on it, so it names the key
   * whose read is in flight — and because an optimistic value lives only while a
   * transition is pending, it reverts on its own the moment nothing is being
   * attempted any more. Two pieces of state would have to be resynchronised by
   * hand, and a transition that dies without committing would strand the first
   * one pointing at a key nothing is loading.
   */
  const [committed, setCommitted] = useState<string>(TOPICS[0]);
  const [clicked, setClicked] = useOptimistic(
    committed,
    (_current, next: string) => next,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTransportKnobs({
      forwardSignal: settings.forwardSignal,
      latencyMs: settings.latencyMs,
    });
  }, [settings.forwardSignal, settings.latencyMs]);

  /**
   * The read starts during render, which includes the server render of this
   * client component — and the instrumented client fetches a relative URL that
   * Node cannot parse. Without this gate the server render throws and React
   * redoes the whole thing on the client for nothing. Everything measured
   * happens in the browser either way.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function select(next: string) {
    if (next === clicked) {
      return;
    }

    // The moment the key moves is the only moment anything knows what it is
    // moving away from. React will not report that the read left behind has been
    // abandoned, so if it is going to be cancelled, it is cancelled here — and
    // the key to name is `clicked`, the one whose read is in flight, not
    // `committed`, which is still the one on screen.
    if (settings.cancelSuperseded) {
      lane.cancel(searchKey(clicked));
    }

    startTransition(() => {
      // Optimistic updates only survive while a transition is pending, so this
      // has to be inside one.
      setClicked(next);
      setCommitted(next);
    });
  }


  return (
    <LabLayout
      summary={SUMMARY}
      controls={
        <>
          <TransportControls
            settings={settings}
            onChange={(patch) =>
              setSettings((current) => ({ ...current, ...patch }))
            }
          />

          <ControlGroup
            title="Cancelling"
            note="Nothing cancels on its own. These are the ways of asking."
          >
            <ControlRow
              label="Cancel on switch"
              note="On, switching topics cancels the key it moved off. Off is the current behaviour: the superseded read runs to completion and fills a cache nobody is reading."
            >
              <Toggle
                checked={settings.cancelSuperseded}
                onChange={(cancelSuperseded) =>
                  setSettings((current) => ({ ...current, cancelSuperseded }))
                }
                labels={["off", "on"]}
              />
            </ControlRow>

            <ControlRow
              label={
                <>
                  Cancel the clicked key —{" "}
                  <code className="font-mono text-cobalt">{clicked}</code>
                </>
              }
              note="The key the last click started. While the transition is pending this is the read that is actually in flight, and it is usually a first load — nothing to revert to, so it ends at the Error Boundary. Watch that no second request for the same key follows it."
            >
              <Button
                size="xs"
                variant="outline"
                disabled={!isPending}
                onClick={() => lane.cancel(searchKey(clicked))}
              >
                cancel
              </Button>
            </ControlRow>

            <ControlRow
              label={
                <>
                  Cancel the committed key —{" "}
                  <code className="font-mono text-foreground">{committed}</code>
                </>
              }
              note="The key whose rows are on screen. Its read is in flight only during a refresh, so on a settled key this does nothing at all — that is the observable."
            >
              <Button
                size="xs"
                variant="outline"
                onClick={() => lane.cancel(searchKey(committed))}
              >
                cancel
              </Button>
            </ControlRow>

            <ControlRow
              label="Refresh, then cancel"
              note="Both in one handler, on the committed key. Invalidate's fan-out starts the re-read synchronously, so the cancel finds it in flight — the revert path without having to be quick."
            >
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  lane.invalidate(searchKey(committed));
                  lane.cancel(searchKey(committed));
                }}
              >
                refresh + cancel
              </Button>
            </ControlRow>

            <ControlRow
              label="Compare"
              note="Invalidate re-reads and converges; remove drops the value entirely. Cancel is neither — it stops without converging. Drop all to get first loads back."
            >
              <span className="flex flex-wrap justify-end gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => lane.invalidate(searchKey(committed))}
                >
                  invalidate
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => lane.remove(searchKey(committed))}
                >
                  remove
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => lane.removeAll(["search"])}
                >
                  drop all
                </Button>
              </span>
            </ControlRow>
          </ControlGroup>
        </>
      }
      main={
        <>
          <section className="rounded-xl border bg-card p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide">
              Topic — one key each
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Click one, then click another before the first lands. The second
              click supersedes the first read; whether it also stops it is the
              toggle above.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {TOPICS.map((option) => (
                <Button
                  key={option}
                  size="xs"
                  variant={option === clicked ? "default" : "outline"}
                  aria-pressed={option === clicked}
                  onClick={() => select(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              clicked:{" "}
              <span className="font-mono text-cobalt">{clicked}</span> ·
              committed:{" "}
              <span className="font-mono text-foreground">{committed}</span>
              <span className={cn(isPending && "text-cobalt")}>
                {isPending
                  ? " · transition pending — the committed topic is what you are looking at"
                  : " · idle"}
              </span>
            </p>
          </section>

          {!mounted ? (
            <ResultsSkeleton />
          ) : (
            <FirstLoadBoundary
              resetKey={committed}
              fallback={(error, retry) => (
                <section className="space-y-3 rounded-xl border border-rose/40 bg-rose/5 p-6 text-center">
                  <p className="text-sm font-medium text-rose">
                    {error instanceof Error ? error.message : String(error)}
                  </p>
                  <p className="mx-auto max-w-md text-xs text-muted-foreground">
                    This read had no previous value, so cancelling it left the
                    key with nothing to show and the abort reached this boundary
                    — the only end a transition holding no data can reach. The
                    key keeps that rejection, which is what stops React retrying
                    the render into a fresh load, so resetting alone re-reads the
                    same rejected promise. It recovers like any other failed
                    first load: invalidate, then retry.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      lane.invalidate(searchKey(committed));
                      retry();
                    }}
                  >
                    Invalidate and retry
                  </Button>
                </section>
              )}
            >
              <Suspense fallback={<ResultsSkeleton />}>
                <SearchResults
                  topic={committed}
                  whenStale={settings.whenStale}
                />
              </Suspense>
            </FirstLoadBoundary>
          )}
        </>
      }
      sidebar={<RequestTimeline />}
    />
  );
}

function ResultsSkeleton() {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Results</h2>
        <span className="text-[11px] text-muted-foreground">
          suspended — no value for this key yet
        </span>
      </div>
      <div className="space-y-2 rounded-lg border bg-surface p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-3.5 w-2/3" />
        ))}
      </div>
    </section>
  );
}
