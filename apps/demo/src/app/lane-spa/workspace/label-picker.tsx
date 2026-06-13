"use client";

import type { TeamLabel } from "@lane/todo-api";
import { Check, Plus, Tag } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useCreateLabel, useLabels } from "@/app/lane-spa/api/hooks";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { accent } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { InlineSpinner } from "./feedback";

export function LabelPicker({
  selectedIds,
  addAction,
  removeAction,
  disabled,
  triggerLabel = "Add label",
}: {
  selectedIds: string[];
  addAction: (label: TeamLabel) => void;
  removeAction: (labelId: string) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const labels = React.use(useLabels().promise);
  const createLabel = useCreateLabel();
  const [isCreating, startCreateTransition] = React.useTransition();

  const selected = new Set(selectedIds);
  const trimmed = search.trim();
  const exactMatch = labels.some(
    (label) => label.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactMatch;

  function toggle(label: TeamLabel) {
    if (selected.has(label.id)) {
      removeAction(label.id);
    } else {
      addAction(label);
    }
  }

  function handleCreate() {
    startCreateTransition(async () => {
      try {
        const label = await createLabel({ name: trimmed });
        addAction(label);
        setSearch("");
        toast.success(`Label “${label.name}” created`);
      } catch (error) {
        toast.error("Couldn't create label", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <Tag className="size-3.5" />
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command loop>
          <CommandInput
            placeholder="Search or create label…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No matching label.</CommandEmpty>
            <CommandGroup>
              {labels.map((label) => (
                <CommandItem
                  key={label.id}
                  value={label.name}
                  onSelect={() => toggle(label)}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      accent(label.color).dot,
                    )}
                  />
                  <span className="flex-1 truncate">{label.name}</span>
                  {selected.has(label.id) ? (
                    <Check className="size-4 text-cobalt" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate ? (
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm text-cobalt transition-colors hover:bg-accent disabled:opacity-60"
              >
                {isCreating ? (
                  <InlineSpinner />
                ) : (
                  <Plus className="size-4" />
                )}
                Create “{trimmed}”
              </button>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
