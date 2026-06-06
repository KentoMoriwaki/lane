"use client";

import { useLanePromise } from "@lane/lane";
import type { Label } from "@lane/todo-api";
import { Suspense, use, useEffect, useState } from "react";
import { fetchLabels, labelLane, labelsKey } from "./todo-label-data";

export function DebugLabelList() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return (
      <section className="debug-label-list" aria-label="Debug labels">
        <div className="debug-label-list-header">
          <span>Labels</span>
          <span>client</span>
        </div>
        <div className="debug-label-empty">Waiting for client mount</div>
      </section>
    );
  }

  return <MountedDebugLabelList />;
}

function MountedDebugLabelList() {
  const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);

  return (
    <section className="debug-label-list" aria-label="Debug labels">
      <div className="debug-label-list-header">
        <span>Labels</span>
        <span>client</span>
      </div>
      <Suspense fallback={<div className="debug-label-empty">Loading labels</div>}>
        <DebugLabelListContent labelsPromise={labelsPromise} />
      </Suspense>
    </section>
  );
}

function DebugLabelListContent({
  labelsPromise,
}: {
  labelsPromise: Promise<Label[]>;
}) {
  const labels = use(labelsPromise);

  if (labels.length === 0) {
    return <div className="debug-label-empty">No labels</div>;
  }

  return (
    <div className="debug-label-items">
      {labels.map((label) => (
        <span className="debug-label-chip" key={label.id}>
          {label.name}
        </span>
      ))}
    </div>
  );
}
