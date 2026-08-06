"use client";

import { Component, Suspense, use, type ReactNode } from "react";
import { useLane } from "use-lane";
import { Button, Select, Toggle } from "./controls";
import {
  LAB_KEY_NAMES,
  STALE_TIMES,
  type LabRead,
  type LabWorld,
  type Variation,
} from "./lane";

export type ResetMode = "clear" | "invalidate" | "remove";

type BoundaryProps = {
  children: ReactNode;
  /**
   * What clears the caught error on its own: a new promise identity is a new
   * read, so the boundary stops showing an error about the previous one without
   * anybody pressing anything.
   *
   * Absent for the integrated pattern, and not as a setting — a boundary below
   * `useLane` cannot be handed a promise it never sees. Separated always passes
   * one; separated without it is a bug in the app, not an arrangement worth
   * reproducing.
   */
  resetKey?: unknown;
  /**
   * The store half of a reset, run before the clear. The clear is the
   * boundary's own and always happens; what an app does *besides* clearing is
   * the axis — nothing, invalidate the key, or remove it.
   */
  onReset: (mode: ResetMode) => void;
};

type BoundaryState = { error: unknown; resetKey: unknown };

/**
 * Lifted from `boundary-reveal.test.ts` (f70c042): catch, and clear the caught
 * error when `resetKey` changes. The clear happens in render
 * (`getDerivedStateFromProps`) rather than after commit, because clearing after
 * commit re-renders the children against the promise the reader still holds —
 * the rejected one — and errors again before any retry's promise has replaced
 * it.
 */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.resetKey === state.resetKey) {
      return null;
    }

    return { error: null, resetKey: props.resetKey };
  }

  /**
   * The reset lives in the fallback, where an app's does: it exists only while
   * there is something to reset, so it cannot be pressed into an empty
   * boundary — which matters because two of the three touch the store.
   *
   * The store first, then the clear: clearing re-renders the children against
   * whatever the key holds at that moment, so an operation applied after it
   * would be applied to a reader that has already read.
   */
  reset = (mode: ResetMode) => {
    this.props.onReset(mode);
    this.setState({ error: null });
  };

  render(): ReactNode {
    return this.state.error !== null ? (
      <ErrorFrame onReset={this.reset} />
    ) : (
      this.props.children
    );
  }
}

/** The world's read for this card's key, with this card's options on it. */
function readOf(world: LabWorld, variation: Variation): LabRead {
  return {
    ...world.reads[variation.keyName],
    whenStale: variation.whenStale,
    staleTime: STALE_TIMES[variation.staleTime],
    refetchOnMount: variation.refetchOnMount,
    refetchOnFocus: variation.refetchOnFocus,
  };
}

/**
 * `useLane` and `use` in one component, wholly under the boundary. A throw
 * unmounts the component that holds the subscription, so the key is left with
 * one less subscriber for as long as the error is on screen.
 */
function IntegratedPanel({
  world,
  variation,
}: {
  world: LabWorld;
  variation: Variation;
}) {
  const { promise, isInvalidationPending, isBackgroundPending } = useLane(
    readOf(world, variation),
  );
  const { data, refreshError } = use(promise);

  return (
    <DataFrame
      value={data}
      refreshError={refreshError}
      invalidationPending={isInvalidationPending}
      backgroundPending={isBackgroundPending}
    />
  );
}

/**
 * `useLane` above the boundary, the promise handed down to a child that `use`s
 * it. The throw takes the child; this component — and with it the subscription
 * and the `invalidate` the fallback could call — stays mounted.
 */
function SeparatedPanel({
  world,
  variation,
  onReset,
}: {
  world: LabWorld;
  variation: Variation;
  onReset: (mode: ResetMode) => void;
}) {
  const { promise, isInvalidationPending, isBackgroundPending } = useLane(
    readOf(world, variation),
  );

  return (
    <Boundary resetKey={promise} onReset={onReset}>
      <Suspense fallback={<SkeletonFrame />}>
        <PromiseChild
          promise={promise}
          invalidationPending={isInvalidationPending}
          backgroundPending={isBackgroundPending}
        />
      </Suspense>
    </Boundary>
  );
}

function PromiseChild({
  promise,
  invalidationPending,
  backgroundPending,
}: {
  promise: Promise<{ data: string; refreshError?: unknown }>;
  invalidationPending: boolean;
  backgroundPending: boolean;
}) {
  const { data, refreshError } = use(promise);

  return (
    <DataFrame
      value={data}
      refreshError={refreshError}
      invalidationPending={invalidationPending}
      backgroundPending={backgroundPending}
    />
  );
}

export function VariationCard({
  world,
  variation,
  onChange,
  onRemove,
}: {
  world: LabWorld;
  variation: Variation;
  onChange: (patch: Partial<Variation>) => void;
  onRemove: () => void;
}) {
  const onReset = (mode: ResetMode) => {
    const key = world.reads[variation.keyName].key;

    if (mode === "invalidate") {
      world.lane.invalidate(key);
    } else if (mode === "remove") {
      world.lane.remove(key);
    }
  };

  return (
    <div className="space-y-3 rounded border border-zinc-300 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-400">#{variation.id}</span>
        <Select
          label=""
          options={["integrated", "separated"] as const}
          value={variation.pattern}
          onChange={(pattern) => onChange({ pattern })}
        />
        <Select
          label="key"
          options={LAB_KEY_NAMES}
          value={variation.keyName}
          onChange={(keyName) => onChange({ keyName })}
        />
        <button
          type="button"
          title="remove this variation"
          className="ml-auto px-1 text-xs text-zinc-400 hover:text-zinc-900"
          onClick={onRemove}
        >
          &#10005;
        </button>
      </div>

      {variation.mounted ? (
        variation.pattern === "integrated" ? (
          // The boundary is outside the reader, so the reader's throw unmounts
          // it — subscription and all.
          <Boundary onReset={onReset}>
            <Suspense fallback={<SkeletonFrame />}>
              <IntegratedPanel world={world} variation={variation} />
            </Suspense>
          </Boundary>
        ) : (
          <SeparatedPanel
            world={world}
            variation={variation}
            onReset={onReset}
          />
        )
      ) : (
        <UnmountedFrame />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select
          label="whenStale"
          options={["revalidate", "refetch"] as const}
          value={variation.whenStale}
          onChange={(whenStale) => onChange({ whenStale })}
        />
        <Select
          label="staleTime"
          options={["none", "0", "5s"] as const}
          value={variation.staleTime}
          onChange={(staleTime) => onChange({ staleTime })}
        />
        <Toggle
          small
          label="onMount"
          checked={variation.refetchOnMount}
          onChange={(refetchOnMount) => onChange({ refetchOnMount })}
        />
        <Toggle
          small
          label="onFocus"
          checked={variation.refetchOnFocus}
          onChange={(refetchOnFocus) => onChange({ refetchOnFocus })}
        />
        <Toggle
          small
          label="mounted"
          checked={variation.mounted}
          onChange={(mounted) => onChange({ mounted })}
        />
      </div>
    </div>
  );
}

/**
 * The four states are meant to be told apart at a glance rather than read, so
 * each one is a shape and a colour first. `data-state` is the same distinction
 * for a script driving the page, which keeps the visuals free to be wordless.
 */
function Frame({
  state,
  className,
  children,
  ...rest
}: {
  state: "data" | "skeleton" | "error" | "unmounted";
  className: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      data-state={state}
      className={`relative flex h-24 items-center justify-center rounded border ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The two pending flags, as edges of the frame rather than words: the explicit
 * one on top, the background one underneath. A transition is the interval where
 * the old value is still on screen and a new one is on its way, so the frame it
 * belongs to is where it belongs.
 */
function PendingEdges({
  invalidation,
  background,
}: {
  invalidation: boolean;
  background: boolean;
}) {
  return (
    <>
      {invalidation ? (
        <span
          title="isInvalidationPending"
          className="absolute inset-x-0 top-0 h-1.5 animate-pulse rounded-t bg-sky-400"
        />
      ) : null}
      {background ? (
        <span
          title="isBackgroundPending"
          className="absolute inset-x-0 bottom-0 h-1.5 animate-pulse rounded-b bg-violet-400"
        />
      ) : null}
    </>
  );
}

/**
 * Data, and — when the last refresh failed over it — the `refreshError` beside
 * it rather than instead of it. That is stale-on-error: the value is still the
 * value, so the frame stays a data frame and the failure is a mark on it. The
 * other reading of the same field, throwing it and losing the subtree, is the
 * `refreshError` axis and comes later.
 */
function DataFrame({
  value,
  refreshError,
  invalidationPending,
  backgroundPending,
}: {
  value: string;
  refreshError: unknown;
  invalidationPending: boolean;
  backgroundPending: boolean;
}) {
  const stale = refreshError !== undefined;

  return (
    <Frame
      state="data"
      data-refresh-error={stale ? "1" : undefined}
      className={
        stale ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-white"
      }
    >
      <PendingEdges
        invalidation={invalidationPending}
        background={backgroundPending}
      />
      <span className="flex items-center gap-3">
        {stale ? (
          <span
            title={String(refreshError)}
            className="text-2xl leading-none text-amber-500"
          >
            &#9888;
          </span>
        ) : null}
        <span data-value={value} className="font-mono text-3xl text-zinc-900">
          {value}
        </span>
      </span>
    </Frame>
  );
}

/** The 500ms delay is here to be watched, so the fallback is worth looking at. */
function SkeletonFrame() {
  return (
    <Frame state="skeleton" className="border-zinc-200 bg-white">
      <div className="w-full animate-pulse space-y-2.5 px-5">
        <div className="h-3 w-2/3 rounded bg-zinc-200" />
        <div className="h-3 w-full rounded bg-zinc-200" />
        <div className="h-3 w-5/12 rounded bg-zinc-200" />
      </div>
    </Frame>
  );
}

function ErrorFrame({ onReset }: { onReset: (mode: ResetMode) => void }) {
  return (
    <Frame state="error" className="border-red-300 bg-red-50">
      <div className="flex items-center gap-4">
        <span className="text-3xl leading-none text-red-400">&#10005;</span>
        <div className="flex flex-col items-stretch gap-1">
          <Button small onClick={() => onReset("clear")}>
            Reset
          </Button>
          <Button small onClick={() => onReset("invalidate")}>
            Reset(Invalidate)
          </Button>
          <Button small onClick={() => onReset("remove")}>
            Reset(Remove)
          </Button>
        </div>
      </div>
    </Frame>
  );
}

/** Nothing is mounted, so the frame holds nothing — an outline of where it was. */
function UnmountedFrame() {
  return (
    <Frame
      state="unmounted"
      className="border-dashed border-zinc-300 bg-zinc-100/60"
    />
  );
}
