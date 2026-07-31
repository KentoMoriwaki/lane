"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { labLog } from "./log";

export type AgitatorKind = "urgent" | "flushSync" | "transition" | "contextTick";

export type Agitator = {
  channel: string;
  agitate(kind: AgitatorKind): void;
};

type Internals = {
  subtreeBump: (() => void) | null;
  tickBump: (() => void) | null;
};

const internals = new WeakMap<Agitator, Internals>();

export function createAgitator(channel: string): Agitator {
  const state: Internals = { subtreeBump: null, tickBump: null };

  const agitator: Agitator = {
    channel,
    agitate(kind) {
      labLog.push(channel, "custom", `agitate:${kind}`);

      if (kind === "contextTick") {
        if (state.tickBump === null) {
          labLog.push(channel, "custom", "agitate:contextTick has no AgitatorTickProvider");
          return;
        }
        state.tickBump();
        return;
      }

      const bump = state.subtreeBump;
      if (bump === null) {
        labLog.push(channel, "custom", `agitate:${kind} has no RenderAgitator`);
        return;
      }

      if (kind === "urgent") {
        bump();
      } else if (kind === "flushSync") {
        flushSync(bump);
      } else {
        startTransition(bump);
      }
    },
  };

  internals.set(agitator, state);
  return agitator;
}

/** Wrap the target subtree; `urgent` / `flushSync` / `transition` re-render from here. */
export function RenderAgitator({
  agitator,
  children,
}: {
  agitator: Agitator;
  children: ReactNode;
}) {
  const [tick, setTick] = useState(0);

  labLog.push(agitator.channel, "render", `wrapper tick=${tick}`);

  useEffect(() => {
    const state = internals.get(agitator);
    if (state === undefined) {
      return;
    }

    state.subtreeBump = () => setTick((current) => current + 1);
    return () => {
      state.subtreeBump = null;
    };
  }, [agitator]);

  // `children` was created by this wrapper's parent, so on a bump every
  // element in it keeps its identity and React bails out of the subtree — the
  // one thing this component exists to cause. Cloning must be deep: a one-level
  // clone re-renders only the immediate child, whose own `props.children` are
  // still the original references, and the bail-out resumes there. Recursing
  // through the JSX-visible tree changes identity at every level without
  // remounting (type/key/position are preserved).
  return cloneDeep(children);
}

function cloneDeep(node: ReactNode): ReactNode {
  if (Array.isArray(node)) {
    return node.map(cloneDeep);
  }
  if (!isValidElement(node)) {
    return node;
  }
  const props = node.props as { children?: ReactNode };
  if (props.children === undefined) {
    return cloneElement(node);
  }
  return cloneElement(node, {}, cloneDeep(props.children));
}

const TickContext = createContext(0);

/** Place ABOVE the Activity boundary; `contextTick` bumps this provider's value. */
export function AgitatorTickProvider({
  agitator,
  children,
}: {
  agitator: Agitator;
  children: ReactNode;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const state = internals.get(agitator);
    if (state === undefined) {
      return;
    }

    state.tickBump = () => setTick((current) => current + 1);
    return () => {
      state.tickBump = null;
    };
  }, [agitator]);

  return <TickContext.Provider value={tick}>{children}</TickContext.Provider>;
}

export function useAgitatorTick(): number {
  return useContext(TickContext);
}

/**
 * Drop inside the (possibly hidden) subtree: a context bump only renders a
 * subtree that consumes the context, and the render it causes is logged here.
 */
export function TickConsumer({ channel }: { channel: string }) {
  const tick = useAgitatorTick();

  labLog.push(channel, "render", `contextTick=${tick}`);

  return (
    <span className="font-mono text-[10px] text-zinc-400" data-tick={tick}>
      tick:{tick}
    </span>
  );
}

const KINDS: readonly AgitatorKind[] = [
  "urgent",
  "flushSync",
  "transition",
  "contextTick",
];

export function AgitatorControls({ agitator }: { agitator: Agitator }) {
  return (
    <div className="flex flex-wrap gap-1">
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => agitator.agitate(kind)}
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-mono text-xs hover:bg-zinc-100"
        >
          {kind}
        </button>
      ))}
    </div>
  );
}
