"use client";

import { Component, Suspense, use, useState, type ReactNode } from "react";
import { LaneReadError, useLane, useLaneInstance } from "use-lane";
import { Button, Select, Toggle } from "./controls";
import {
  LAB_KEY_NAMES,
  READ_GC_TIMES,
  STALE_TIMES,
  WARM_TIMES,
  type LabRead,
  type LabWorld,
  type ErrorMode,
  type Variation,
} from "./lane";

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

  clear = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    return this.state.error !== null ? (
      <ErrorFrame error={this.state.error} clear={this.clear} />
    ) : (
      this.props.children
    );
  }
}

/** The world's read for this card's key, with this card's options on it. */
function readOf(world: LabWorld, variation: Variation): LabRead {
  return {
    ...world.reads[variation.keyName],
    gcTime: READ_GC_TIMES[variation.gcTime],
    warmTime: WARM_TIMES[variation.warmTime],
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
  const { data, error } = use(promise);

  return (
    <DataFrame
      value={data}
      error={error}
      mode={variation.error}
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
}: {
  world: LabWorld;
  variation: Variation;
}) {
  const { promise, isInvalidationPending, isBackgroundPending } = useLane(
    readOf(world, variation),
  );

  return (
    <Boundary resetKey={promise}>
      <Suspense fallback={<SkeletonFrame />}>
        <PromiseChild
          promise={promise}
          mode={variation.error}
          invalidationPending={isInvalidationPending}
          backgroundPending={isBackgroundPending}
        />
      </Suspense>
    </Boundary>
  );
}

function PromiseChild({
  promise,
  mode,
  invalidationPending,
  backgroundPending,
}: {
  promise: Promise<{ data: string; error?: unknown }>;
  mode: ErrorMode;
  invalidationPending: boolean;
  backgroundPending: boolean;
}) {
  const { data, error } = use(promise);

  return (
    <DataFrame
      value={data}
      error={error}
      mode={mode}
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
          <Boundary>
            <Suspense fallback={<SkeletonFrame />}>
              <IntegratedPanel world={world} variation={variation} />
            </Suspense>
          </Boundary>
        ) : (
          <SeparatedPanel world={world} variation={variation} />
        )
      ) : (
        <UnmountedFrame />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select
          label="gcTime"
          options={["lane", "0", "5s"] as const}
          value={variation.gcTime}
          onChange={(gcTime) => onChange({ gcTime })}
        />
        <Select
          label="warmTime"
          options={["lane", "0", "3s"] as const}
          value={variation.warmTime}
          onChange={(warmTime) => onChange({ warmTime })}
        />
        <Select
          label="staleTime"
          options={["none", "0", "5s"] as const}
          value={variation.staleTime}
          onChange={(staleTime) => onChange({ staleTime })}
        />
        <Select
          label="error"
          options={["inline", "throw"] as const}
          value={variation.error}
          onChange={(error) => onChange({ error })}
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
 * Data, and — when the last refresh failed over it — the `error` beside
 * it rather than instead of it. That is stale-on-error: the value is still the
 * value, so the frame stays a data frame and the failure is a mark on it. The
 * other reading of the same field, throwing it and losing the subtree, is the
 * `error` axis and comes later.
 */
function DataFrame({
  value,
  error,
  mode,
  invalidationPending,
  backgroundPending,
}: {
  value: string;
  error: unknown;
  mode: ErrorMode;
  invalidationPending: boolean;
  backgroundPending: boolean;
}) {
  // Thrown from the component that renders the data, which is where an app
  // would do it — and the whole difference is what goes with it. Everything
  // below this line, the input included, is replaced by the fallback.
  if (error !== undefined && mode === "throw") {
    throw error;
  }

  const stale = error !== undefined;

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
      <div className="flex flex-col items-center gap-2">
        <span className="flex items-center gap-3">
          {stale ? (
            <span
              title={String(error)}
              className="text-2xl leading-none text-amber-500"
            >
              &#9888;
            </span>
          ) : null}
          <span data-value={value} className="font-mono text-3xl text-zinc-900">
            {value}
          </span>
        </span>
        <LocalState />
      </div>
    </Frame>
  );
}

/**
 * State that belongs to the subtree and to nothing else — type into it and it is
 * whatever the app would have had here: a half-filled form, a scroll position, an
 * open menu. Anything that unmounts this subtree takes it, which is what makes
 * the `error: throw` axis cost something visible.
 */
function LocalState() {
  const [text, setText] = useState("");

  return (
    <input
      value={text}
      onChange={(event) => setText(event.target.value)}
      placeholder="local state"
      className="w-40 rounded border border-zinc-200 px-2 py-0.5 text-center text-xs"
    />
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

/**
 * One button, and it knows nothing about this card. The failed read threw a
 * `LaneReadError` carrying its key, and the lane is a context read away — so
 * the fallback can invalidate what failed without being told what it was
 * reading. That is the whole recovery: the store first, then the boundary's own
 * clear, because clearing re-renders the children against whatever the key
 * holds at that moment.
 */
function ErrorFrame({ error, clear }: { error: unknown; clear: () => void }) {
  const lane = useLaneInstance();

  return (
    <Frame state="error" className="border-red-300 bg-red-50">
      <div className="flex items-center gap-4">
        <span
          title={String(error)}
          className="text-3xl leading-none text-red-400"
        >
          &#10005;
        </span>
        <Button
          onClick={() => {
            if (error instanceof LaneReadError) {
              lane.invalidate(error.key);
            }

            clear();
          }}
        >
          Retry
        </Button>
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
