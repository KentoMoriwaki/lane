"use client";

import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SearchField } from "./use-debounced-search-field";

export function Topbar({
  searchField,
  onNewTask,
  onRefresh,
  isRefreshing,
}: {
  searchField: SearchField;
  onNewTask: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchField.value}
          onChange={searchField.onChange}
          onCompositionEnd={searchField.onCompositionEnd}
          placeholder="Search tasks, labels…"
          className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              aria-label="Refresh workspace"
            >
              <RefreshCw
                className={cn("size-4", isRefreshing && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isRefreshing ? "Syncing…" : "Refresh"}
          </TooltipContent>
        </Tooltip>
        <Button onClick={onNewTask}>
          <Plus className="size-4" />
          New task
        </Button>
      </div>
    </header>
  );
}
