"use client";

import {
  Component,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useLane } from "use-lane";
import { labLog } from "@/lab/log";
import { outsideReads } from "./reads";
import { readerState } from "./reader-state";
import { trackValue } from "./weak-probe";

const CHANNEL = "outside:reader";

/**
 * The reader this scene exists for: it lives in the **layout**, above every
 * page, so no `<LaneHydration>` boundary is an ancestor of it and no prop can
 * reach it. `loader: external` is the whole contract — it waits for whichever
 * page publishes the key next.
 */
function OutsideReaderInner() {
  const result = useLane(outsideReads.topic());
  const bg = result.isBackgroundPending;
  const tr = result.isInvalidationPending;

  labLog.push(CHANNEL, "render", `bg:${bg ? 1 : 0} tr:${tr ? 1 : 0}`);

  // Every commit, so the HUD's "committed at" is the last one and not the first.
  useLayoutEffect(() => {
    readerState.observeCommit(performance.now());
  });

  useLayoutEffect(() => {
    labLog.push(CHANNEL, "layout-mount");
    return () => {
      labLog.push(CHANNEL, "layout-cleanup");
    };
  }, []);

  useEffect(() => {
    labLog.push(CHANNEL, "passive-mount");
    return () => {
      labLog.push(CHANNEL, "passive-cleanup");
    };
  }, []);

  const value = use(result.promise);
  const at = performance.now();

  labLog.push(CHANNEL, "custom", `value=${value.data.text}`);
  readerState.observeRender(value.data.text, value.data.n, at, bg, tr);
  trackValue("topic", value.data.n, value.data);

  return (
    <div className="font-mono text-sm">
      <span
        className="rounded bg-emerald-100 px-2 py-1 font-bold text-emerald-900"
        data-outside-value=""
      >
        {value.data.text}
      </span>
      <span className={bg ? "ml-2 text-amber-600" : "ml-2 text-zinc-300"}>
        bg:{bg ? 1 : 0}
      </span>
      <span className={tr ? "ml-1 text-amber-600" : "ml-1 text-zinc-300"}>
        tr:{tr ? 1 : 0}
      </span>
    </div>
  );
}

function OutsideFallback() {
  labLog.push(CHANNEL, "custom", "suspense-fallback render");

  // Layout, not passive: the question is how long a fallback was *on screen*,
  // and the layout pair brackets the commit that put it there.
  useLayoutEffect(() => {
    const at = performance.now();
    readerState.openFallback(at);
    labLog.push(CHANNEL, "custom", "fallback-commit");
    return () => {
      const closedAt = performance.now();
      readerState.closeFallback(closedAt);
      labLog.push(CHANNEL, "custom", "fallback-cleanup");
    };
  }, []);

  return (
    <div
      className="animate-pulse rounded border-2 border-dashed border-orange-500 bg-orange-100 px-2 py-1 font-mono text-sm font-bold text-orange-700"
      data-outside-fallback=""
    >
      SUSPENDED (outside reader)
    </div>
  );
}

type BoundaryState = { error: Error | null };

/** Catches what an unpublished key eventually throws: `LaneExternalTimeoutError`. */
class ReaderErrorBoundary extends Component<
  { onError: (error: unknown) => void; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    const keyed = error as Error & { keyId?: string };

    return (
      <div
        className="rounded border-2 border-red-500 bg-red-50 px-2 py-1 font-mono text-xs text-red-800"
        data-outside-error=""
      >
        <div className="font-bold">{error.name}</div>
        <div>keyId: {keyed.keyId ?? "(none)"}</div>
        <div className="mt-1 whitespace-pre-wrap">{error.message}</div>
      </div>
    );
  }
}

export function OutsideReader() {
  return (
    <ReaderErrorBoundary
      onError={(error) => {
        const at = performance.now();
        const named = error as { name?: string; message?: string };
        labLog.push(
          CHANNEL,
          "custom",
          `ERROR ${named?.name ?? "?"}: ${named?.message ?? String(error)}`,
        );
        readerState.observeError(error, at);
      }}
    >
      <Suspense fallback={<OutsideFallback />}>
        <OutsideReaderInner />
      </Suspense>
    </ReaderErrorBoundary>
  );
}

/**
 * A second, throwaway reader of the same key, mounted on demand. It is how the
 * HUD reports the entry's state without reaching into the store: a fresh read
 * that commits with no fallback found a live value in the slot; one that
 * suspends found the slot empty (never published, or its value collected) and
 * is now waiting for the next publication.
 */
function StoreProbeReader({ id }: { id: number }) {
  const result = useLane(outsideReads.topic());
  const value = use(result.promise);

  useLayoutEffect(() => {
    readerState.probeResolved(id, performance.now(), value.data.text);
    labLog.push("outside:probe", "custom", `resolved ${value.data.text}`);
  }, [id, value.data.text]);

  return (
    <span className="font-mono text-xs text-zinc-700" data-probe-value="">
      {value.data.text}
    </span>
  );
}

function StoreProbeFallback({ id }: { id: number }) {
  useLayoutEffect(() => {
    readerState.probeFallback(id, performance.now());
    labLog.push("outside:probe", "custom", "fallback-commit");
  }, [id]);

  return <span className="font-mono text-xs text-orange-600">waiting…</span>;
}

class ProbeErrorBoundary extends Component<
  { id: number; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    readerState.probeError(this.props.id, performance.now(), error);
    labLog.push("outside:probe", "custom", `ERROR ${error.name}`);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <span className="font-mono text-xs text-red-700">
          {this.state.error.name}
        </span>
      );
    }

    return this.props.children;
  }
}

export function StoreProbe() {
  const [mount, setMount] = useState<number | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          const id = (mount ?? 0) + 1;
          labLog.push("outside:probe", "custom", `mount #${id}`);
          readerState.startProbe(id, performance.now());
          setMount(id);
        }}
        className="rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-semibold hover:bg-zinc-100"
      >
        probe store (fresh reader)
      </button>
      <button
        type="button"
        onClick={() => setMount(null)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100"
      >
        unmount probe
      </button>
      {mount !== null && (
        <ProbeErrorBoundary id={mount} key={mount}>
          <Suspense fallback={<StoreProbeFallback id={mount} />}>
            <StoreProbeReader id={mount} />
          </Suspense>
        </ProbeErrorBoundary>
      )}
    </div>
  );
}
