"use client";

import type { TaskStatus } from "@lane/todo-api";
import { Check } from "lucide-react";
import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { accent } from "@/lib/accent";
import { STATUS_META, STATUS_ORDER } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

export function StatusControl({
  value,
  changeAction,
  variant = "full",
  pending,
  disabled,
}: {
  value: TaskStatus;
  changeAction: (next: TaskStatus) => void;
  variant?: "full" | "icon";
  pending?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const meta = STATUS_META[value];
  const Icon = meta.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
          variant === "full"
            ? "h-8 border border-input bg-surface px-2.5 hover:bg-accent"
            : "size-6 justify-center hover:bg-accent",
          pending && "opacity-70",
        )}
        aria-label={`Status: ${meta.label}`}
      >
        <Icon className={cn("size-4", accent(meta.accent).text)} />
        {variant === "full" ? (
          <span className="font-medium">{meta.label}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48"
        onClick={(event) => event.stopPropagation()}
      >
        {STATUS_ORDER.map((status) => {
          const optionMeta = STATUS_META[status];
          const OptionIcon = optionMeta.icon;
          return (
            <button
              key={status}
              type="button"
              onClick={() => {
                setOpen(false);
                if (status !== value) changeAction(status);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <OptionIcon
                className={cn("size-4", accent(optionMeta.accent).text)}
              />
              <span className="flex-1">{optionMeta.label}</span>
              {status === value ? (
                <Check className="size-4 text-cobalt" />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
