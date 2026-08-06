"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { LaneProvider } from "use-lane";
import { Button, Choice, Row } from "./controls";
import {
  createVariation,
  createWorld,
  initialOptions,
  LAB_KEY_NAMES,
  type LabKeyName,
  type LabOptions,
  type LabWorld,
  type Variation,
} from "./lane";
import { VariationCard } from "./variation";

/**
 * The lane and everything under it. Rebuilt by Reload; the cards above it are
 * not, which is what lets the same arrangement be run twice.
 */
function World({
  world,
  variations,
  onChange,
  onRemove,
}: {
  world: LabWorld;
  variations: readonly Variation[];
  onChange: (id: number, patch: Partial<Variation>) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <LaneProvider lane={world.lane}>
      <section className="space-y-4 rounded border border-zinc-300 bg-zinc-50 p-4">
        <h2 className="font-mono text-xs tracking-wide text-zinc-500">
          lane #{world.id} · gc {world.gcTime}
        </h2>

        {/* What the store is told, addressed by key rather than by reader. */}
        {LAB_KEY_NAMES.map((keyName) => (
          <KeyRow key={keyName} world={world} keyName={keyName} />
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          {variations.map((variation) => (
            <VariationCard
              key={variation.id}
              world={world}
              variation={variation}
              onChange={(patch) => onChange(variation.id, patch)}
              onRemove={() => onRemove(variation.id)}
            />
          ))}
        </div>
      </section>
    </LaneProvider>
  );
}

function KeyRow({
  world,
  keyName,
}: {
  world: LabWorld;
  keyName: LabKeyName;
}) {
  const calls = useSyncExternalStore(
    world.subscribeCalls,
    () => world.getCalls(keyName),
    () => world.getCalls(keyName),
  );

  return (
    <Row label={`key ${keyName}`}>
      <Button onClick={() => world.lane.invalidate(world.reads[keyName].key)}>
        Invalidate
      </Button>
      <Button onClick={() => world.lane.remove(world.reads[keyName].key)}>
        Remove
      </Button>
      <span className="text-xs text-zinc-500">
        loader calls <b className="font-mono text-zinc-900">{calls}</b>
      </span>
    </Row>
  );
}

export function ErrorLab() {
  // Two readers of the same options: React, for the switches, and the loaders
  // inside the world, which run during a render they are not part of and so are
  // handed a getter instead of a prop. The ref is what the getter reads; it is
  // only ever written from an event handler.
  const optionsRef = useRef<LabOptions>(initialOptions);
  const [options, setOptions] = useState<LabOptions>(initialOptions);
  const [variations, setVariations] = useState<Variation[]>(() => [
    createVariation(),
  ]);
  // The world is state, so Reload is `setWorld(createWorld(…))` — a new lane, a
  // new counter, the cards remounted by its `key`. The options and the cards
  // around it are this component's own state and survive it, which is the
  // difference from reloading the browser and the reason this control exists.
  const [world, setWorld] = useState(() =>
    createWorld(() => optionsRef.current),
  );

  const change = (patch: Partial<LabOptions>) => {
    const next = { ...optionsRef.current, ...patch };
    optionsRef.current = next;
    setOptions(next);
  };

  const changeVariation = (id: number, patch: Partial<Variation>) => {
    setVariations((current) =>
      current.map((variation) =>
        variation.id === id ? { ...variation, ...patch } : variation,
      ),
    );
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-10">
      <h1 className="text-xl font-bold">read-lab</h1>

      {/* Outside the lane: what the loaders do, how the store is built, and
          what starts a new one. Everything a single read decides is on a card. */}
      <section className="space-y-3 rounded border border-zinc-200 bg-zinc-100 p-4">
        <h2 className="font-mono text-xs tracking-wide text-zinc-500">
          options
        </h2>

        <Row label="failure">
          <Choice
            name="failure"
            options={["never", "always"] as const}
            value={options.failure}
            onChange={(failure) => change({ failure })}
          />
        </Row>

        <Row label="gcTime">
          <Choice
            name="gcTime"
            options={["infinity", "5s"] as const}
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
          <Button
            onClick={() =>
              setVariations((current) => [...current, createVariation()])
            }
          >
            Add variation
          </Button>
          <span className="text-xs text-zinc-500">
            a fresh lane; the options and the cards stay as they are
          </span>
        </Row>
      </section>

      <World
        key={world.id}
        world={world}
        variations={variations}
        onChange={changeVariation}
        onRemove={(id) =>
          setVariations((current) =>
            current.filter((variation) => variation.id !== id),
          )
        }
      />
    </main>
  );
}
