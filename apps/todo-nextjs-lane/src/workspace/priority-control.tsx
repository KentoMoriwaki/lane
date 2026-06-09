"use client";

import type { TaskPriority } from "@lane/todo-api";
import { Check } from "lucide-react";
import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { accent } from "@/lib/accent";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

export function PriorityControl({
  value,
  changeAction,
  variant = "full",
  pending,
  disabled,
}: {
  value: TaskPriority;
  changeAction: (next: TaskPriority) => void;
  variant?: "full" | "icon";
  pending?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const meta = PRIORITY_META[value];
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
        aria-label={`Priority: ${meta.label}`}
      >
        <Icon className={cn("size-4", accent(meta.accent).text)} />
        {variant === "full" ? (
          <span className={cn("font-medium", value === "none" && "text-muted-foreground")}>
            {meta.label}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        {PRIORITY_ORDER.map((priority) => {
          const optionMeta = PRIORITY_META[priority];
          const OptionIcon = optionMeta.icon;
          return (
            <button
              key={priority}
              type="button"
              onClick={() => {
                setOpen(false);
                if (priority !== value) changeAction(priority);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <OptionIcon
                className={cn("size-4", accent(optionMeta.accent).text)}
              />
              <span className="flex-1">{optionMeta.label}</span>
              {priority === value ? (
                <Check className="size-4 text-cobalt" />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
