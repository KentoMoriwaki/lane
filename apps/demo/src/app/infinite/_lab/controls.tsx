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
import { cn } from "@/lib/utils";
import type { useDatasetMutations } from "./dataset";
import type { LabSettings } from "./types";

/**
 * Controls that are about the *server* and the *page*, not about any library:
 * what the endpoint is asked for, how it is made to behave, and direct edits to
 * the dataset behind it.
 *
 * Every control carries a one-line note describing the **observable** — what to
 * watch in the request log or in the list — and deliberately not the
 * conclusion. The lab exists to find out what actually happens; a control that
 * tells you the answer in advance defeats the purpose.
 *
 * The small primitives (`ControlGroup`, `ControlRow`, `NumberSelect`, `Toggle`)
 * are exported so a variant can render its own controls — a `staleTime` select,
 * an invalidate button, whatever that library actually has — in the same visual
 * language, without any of it leaking into the shared layer.
 */

export function ServerKnobControls({
  settings,
  onChange,
}: {
  settings: LabSettings;
  onChange: (patch: Partial<LabSettings>) => void;
}) {
  return (
    <>
      <ControlGroup
        title="Request shape"
        note="What the endpoint is asked for. Changing one of these is a different list of rows."
      >
        <ControlRow
          label="Page size"
          note="Same rows, different windowing; watch whether the already-loaded pages survive the change."
        >
          <NumberSelect
            value={settings.limit}
            options={[5, 10, 20, 50]}
            onChange={(limit) => onChange({ limit })}
          />
        </ControlRow>

        <ControlRow
          label="Sort"
          note="Changes the key the server pages through; watch the page count and which cursor the first request carries."
        >
          <Select
            value={settings.sort}
            onValueChange={(sort) =>
              onChange({ sort: sort as LabSettings["sort"] })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">newest first</SelectItem>
              <SelectItem value="oldest">oldest first</SelectItem>
              <SelectItem value="title">title A→Z</SelectItem>
            </SelectContent>
          </Select>
        </ControlRow>

        <ControlRow
          label="Cursor semantics"
          note="keyset resumes after a named row; offset resumes at a position. Watch the page boundaries after an insert."
        >
          <Select
            value={settings.cursorMode}
            onValueChange={(cursorMode) =>
              onChange({ cursorMode: cursorMode as LabSettings["cursorMode"] })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keyset">keyset (anchor row)</SelectItem>
              <SelectItem value="offset">offset (position)</SelectItem>
            </SelectContent>
          </Select>
        </ControlRow>
      </ControlGroup>

      <ControlGroup
        title="Transport knobs"
        note="Sent with every request and read at call time, so they can be changed while pages are already loaded."
      >
        <ControlRow
          label="Latency"
          note="Stretches every bar in the log; the gap between bars is what shows whether one waited for another."
        >
          <NumberSelect
            value={settings.latencyMs}
            options={[0, 100, 300, 800, 1500]}
            format={(value) => `${value}ms`}
            onChange={(latencyMs) => onChange({ latencyMs })}
          />
        </ControlRow>

        <ControlRow
          label="Fail at page"
          note="The server derives the page index from the cursor and returns 500 for that one; watch what happens to the pages before it."
        >
          <NumberSelect
            value={settings.failAt ?? 0}
            options={[0, 1, 2, 3, 4, 5]}
            format={(value) => (value === 0 ? "never" : `page ${value}`)}
            onChange={(value) =>
              onChange({ failAt: value === 0 ? null : value })
            }
          />
        </ControlRow>

        <ControlRow
          label="Auto-load on scroll"
          note="A sentinel at the bottom of the list asks for the next page; scrolling fast can fire several in a row."
        >
          <Toggle
            checked={settings.autoLoad}
            onChange={(autoLoad) => onChange({ autoLoad })}
            labels={["off", "on"]}
          />
        </ControlRow>

        <ControlRow
          label="Load-more burst"
          note="How many load-more calls each trigger fires in one tick — the button and the scroll sentinel both. Above 1 asks what the library does when several land at once: consecutive pages, one deduped page, or one cancelling the others. It needs a control because it cannot be done by hand — the trigger is guarded before a second click lands."
        >
          <NumberSelect
            value={settings.loadMoreBurst}
            options={[1, 2, 3, 5]}
            onChange={(loadMoreBurst) => onChange({ loadMoreBurst })}
          />
        </ControlRow>

        <ControlRow
          label="Mount the list"
          note="Unmount, then remount: whatever comes back without a request came from cache, not from the component."
        >
          <Toggle
            checked={settings.listMounted}
            onChange={(listMounted) => onChange({ listMounted })}
            labels={["unmounted", "mounted"]}
          />
        </ControlRow>
      </ControlGroup>
    </>
  );
}

export function DatasetControls({
  mutations,
}: {
  mutations: ReturnType<typeof useDatasetMutations>;
}) {
  return (
    <ControlGroup
      title="Perturb the dataset"
      note="Direct edits to the server's collection. Nothing here notifies the client — you decide when to re-read."
    >
      <ControlRow
        label="Insert a row at the head"
        note="Everything below it shifts by one on the server; the loaded pages on screen do not move until they are re-read."
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => void mutations.prepend()}
          disabled={mutations.busy !== null}
        >
          Prepend
        </Button>
      </ControlRow>

      <ControlRow
        label="Edit or delete a row"
        note="Use the pencil / trash buttons on any row, then re-read — watch the resolution chip on the page that followed the deleted row."
      >
        <span className="text-[11px] text-muted-foreground">in the list →</span>
      </ControlRow>

      <ControlRow
        label="Reset the dataset"
        note="Restores the 500 generated rows; the client keeps whatever it had until it re-reads."
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => void mutations.reset()}
          disabled={mutations.busy !== null}
        >
          Reset
        </Button>
      </ControlRow>

      {mutations.busy || mutations.error ? (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            mutations.error
              ? "border-rose/40 bg-rose/5 text-rose"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          {mutations.error ?? `${mutations.busy}…`}
        </p>
      ) : null}
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
  label: string;
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
