"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CancelLabSettings } from "./types";

/**
 * Controls that are about the server and the page, not about the library.
 *
 * Every control carries a one-line note describing the **observable** — what to
 * watch in the request log or on screen — and deliberately not the conclusion.
 * The lab exists to find out what actually happens; a control that gives away
 * the answer defeats the purpose.
 *
 * The primitives are exported so the page can render its own lane-specific
 * controls in the same visual language without any of it leaking down here.
 */

export function TransportControls({
  settings,
  onChange,
}: {
  settings: CancelLabSettings;
  onChange: (patch: Partial<CancelLabSettings>) => void;
}) {
  return (
    <ControlGroup
      title="Transport"
      note="How long a read stays in flight, and whether the loader cooperates with an abort."
    >
      <ControlRow
        label="Latency"
        note="Type faster than this and the key moves on before the request lands. That gap is the entire subject of the lab."
      >
        <NumberSelect
          value={settings.latencyMs}
          options={[0, 300, 800, 1200, 3000, 10000]}
          onChange={(latencyMs) => onChange({ latencyMs })}
          format={(option) => `${option} ms`}
        />
      </ControlRow>

      <ControlRow
        label="Loader forwards signal"
        note="Off drops the signal on the floor, the way a loader written without one does. Watch whether the log still says aborted — and whether the screen agrees."
      >
        <Toggle
          checked={settings.forwardSignal}
          onChange={(forwardSignal) => onChange({ forwardSignal })}
          labels={["dropped", "forwarded"]}
        />
      </ControlRow>
    </ControlGroup>
  );
}

export function ControlGroup({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

export function ControlRow({
  label,
  note,
  children,
}: {
  // A node rather than a string so a control can name the key it acts on, which
  // is the only way "cancel" is unambiguous while two keys are in play.
  label: ReactNode;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="w-32 justify-self-end text-right">{children}</div>
      <p className="col-span-2 text-[11px] leading-snug text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

export function NumberSelect({
  value,
  options,
  onChange,
  format = (option) => String(option),
}: {
  value: number;
  options: number[];
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Toggle({
  checked,
  onChange,
  labels,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labels: [string, string];
}) {
  return (
    <Button
      size="xs"
      variant={checked ? "default" : "outline"}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      {checked ? labels[1] : labels[0]}
    </Button>
  );
}
