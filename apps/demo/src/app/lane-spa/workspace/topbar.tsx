"use client";

import { Plus, RefreshCw, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Topbar({
  search,
  onSearchChange,
  onNewTask,
  onRefresh,
  isRefreshing,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onNewTask: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const [optimisticSearch, setOptimisticSearch] = React.useOptimistic(
    search,
    (_current, next: string) => next,
  );
  const searchSequence = React.useRef(0);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={optimisticSearch}
          onChange={(event) => {
            const next = event.target.value;
            const sequence = searchSequence.current + 1;
            searchSequence.current = sequence;

            React.startTransition(async () => {
              setOptimisticSearch(next);
              await sleep(300);
              if (searchSequence.current !== sequence) {
                return;
              }
              onSearchChange(next);
            });
          }}
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
