"use client";

import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/app/react-query/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/app/react-query/components/ui/tooltip";
import { cn } from "@/app/react-query/lib/utils";

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
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
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
