"use client";

import {
  Component,
  Suspense,
  use,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LaneProvider, useLane } from "use-lane";
import {
  createWorld,
  initialOptions,
  STALE_TIMES,
  type LabOptions,
  type LabWorld,
} from "./lane";

type BoundaryProps = {
  children: ReactNode;
  /**
   * The `resetKey` axis. Always absent for now, which is the "none" setting:
   * nothing changes it, so only the Reset button below clears the error. The
   * promise form — where a new promise identity clears it on its own — arrives
   * with the "hand the promise to a child" pattern, since a boundary above the
   * reader is the only one that can see the promise at all.
   */
  resetKey?: unknown;
  /**
   * The store half of a reset, run before the clear. The clear is the boundary's
   * own and always happens; what an app does *besides* clearing is the axis —
   * nothing, invalidate the key, or remove it — so the three are three buttons
   * rather than a mode to pick first and then apply.
   */
  onReset: (mode: ResetMode) => void;
};

export type ResetMode = "clear" | "invalidate" | "remove";

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
   * boundary — which matters now that two of the three also touch the store.
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

/**
 * The "use it yourself" implementation pattern: `useLane` and `use` in one
 * component, wholly under the boundary. Throwing takes the subscription with
 * it, because the component that held it is the component that unmounted.
 */
function Reader({ world, options }: { world: LabWorld; options: LabOptions }) {
  // The read is the world's (its key and its loader), read with the options set
  // above it. Specs are plain objects with no identity to preserve, so building
  // one per render is the ordinary way to do this.
  const { promise, isInvalidationPending, isBackgroundPending } = useLane({
    ...world.read,
    whenStale: options.whenStale,
    staleTime: STALE_TIMES[options.staleTime],
    refetchOnMount: options.refetchOnMount,
    refetchOnFocus: options.refetchOnFocus,
  });
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
 * One run of the lab, from an empty store. Everything the lane owns is inside
 * here — the provider, the key operations, the boundary, the reader, and the
 * counter watching them — so Reload can rebuild all of it while the options
 * above stay exactly as they were set.
 *
 * The rows are the layering, and the layering is the point of the lab: what the
 * *store* is told (`invalidate` / `remove`, addressed by key), what the *app's
 * boundary* does about an error it caught (Reset), and whether the reader is on
 * screen at all (mounted). A recipe is a sequence across these three, and which
 * row an operation came from is most of what its outcome means.
 */
function World({ world, options }: { world: LabWorld; options: LabOptions }) {
  const [mounted, setMounted] = useState(true);
  const calls = useSyncExternalStore(
    world.subscribeCalls,
    world.getCalls,
    world.getCalls,
  );

  return (
    <LaneProvider lane={world.lane}>
      <section className="space-y-4 rounded border border-zinc-300 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-xs tracking-wide text-zinc-500">
            lane #{world.id} · gc {world.gcTime}
          </h2>
          <span className="text-xs text-zinc-500">
            loader calls <b className="font-mono text-zinc-900">{calls}</b>
          </span>
        </div>

        <Row label={'key ["lab"]'}>
          <Button onClick={() => world.lane.invalidate(world.read.key)}>
            Invalidate
          </Button>
          <Button onClick={() => world.lane.remove(world.read.key)}>
            Remove
          </Button>
        </Row>

        {mounted ? (
          <Boundary
            onReset={(mode) => {
              if (mode === "invalidate") {
                world.lane.invalidate(world.read.key);
              } else if (mode === "remove") {
                world.lane.remove(world.read.key);
              }
            }}
          >
            <Suspense fallback={<SkeletonFrame />}>
              <Reader world={world} options={options} />
            </Suspense>
          </Boundary>
        ) : (
          <UnmountedFrame />
        )}

        <Row label="reader">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={mounted}
              onChange={(event) => setMounted(event.target.checked)}
            />
            mounted
          </label>
          <span className="text-xs text-zinc-500">
            takes the boundary and the reader with it; the store is untouched
          </span>
        </Row>
      </section>
    </LaneProvider>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-xs text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Button({
  onClick,
  disabled,
  small,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded border border-zinc-300 bg-white disabled:opacity-40 ${
        small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ErrorLab() {
  // Two readers of the same options: React, for the switches, and the loader
  // inside the world, which runs during a render it is not part of and so is
  // handed a getter instead of a prop. The ref is what the getter reads; it is
  // only ever written from an event handler.
  const optionsRef = useRef<LabOptions>(initialOptions);
  const [options, setOptions] = useState<LabOptions>(initialOptions);
  // The world is state, so Reload is `setWorld(createWorld(…))` — a new lane, a
  // new counter, a subtree remounted by its `key`. The options around it are
  // this component's own state and survive it, which is the difference from
  // reloading the browser and the reason this control exists at all.
  const [world, setWorld] = useState(() => createWorld(() => optionsRef.current));

  const change = (patch: Partial<LabOptions>) => {
    const next = { ...optionsRef.current, ...patch };
    optionsRef.current = next;
    setOptions(next);
  };

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-xl font-bold">error-lab</h1>

      {/* Outside the lane: what a run is set up with, and what starts a new one. */}
      <section className="space-y-3 rounded border border-zinc-200 bg-zinc-100 p-4">
        <h2 className="font-mono text-xs tracking-wide text-zinc-500">
          options
        </h2>

        <Row label="failure">
          <Choice
            name="failure"
            options={["never", "always"]}
            value={options.failure}
            onChange={(failure) => change({ failure })}
          />
        </Row>

        <Row label="whenStale">
          <Choice
            name="whenStale"
            options={["revalidate", "refetch"]}
            value={options.whenStale}
            onChange={(whenStale) => change({ whenStale })}
          />
        </Row>

        <Row label="staleTime">
          <Choice
            name="staleTime"
            options={["none", "0", "5s"]}
            value={options.staleTime}
            onChange={(staleTime) => change({ staleTime })}
          />
          <span className="text-xs text-zinc-500">
            none = absent = Infinity
          </span>
        </Row>

        <Row label="triggers">
          <Toggle
            label="refetchOnMount"
            checked={options.refetchOnMount}
            onChange={(refetchOnMount) => change({ refetchOnMount })}
          />
          <Toggle
            label="refetchOnFocus"
            checked={options.refetchOnFocus}
            onChange={(refetchOnFocus) => change({ refetchOnFocus })}
          />
          <span className="text-xs text-zinc-500">
            focus fires on a tab switch
          </span>
        </Row>

        <Row label="gcTime">
          <Choice
            name="gcTime"
            options={["infinity", "5s"]}
            value={options.gcTime}
            onChange={(gcTime) => change({ gcTime })}
          />
          <span className="text-xs text-zinc-500">
            fixed when the lane is built — Reload to apply
          </span>
        </Row>

        <Row label="world">
          <Button
            onClick={() => setWorld(createWorld(() => optionsRef.current))}
          >
            Reload
          </Button>
          <span className="text-xs text-zinc-500">
            a fresh lane; these options stay as they are
          </span>
        </Row>
      </section>

      <World key={world.id} world={world} options={options} />
    </main>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function Choice<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex items-center gap-3 text-sm">
      <legend className="sr-only">{name}</legend>
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </fieldset>
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
      className={`relative flex h-24 w-64 items-center justify-center rounded border ${className}`}
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
