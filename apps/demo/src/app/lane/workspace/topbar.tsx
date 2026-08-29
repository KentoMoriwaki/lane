"use client";

import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as React from "react";
import {
  useDebouncedSearchField,
  type SearchField as SearchFieldValue,
} from "./use-debounced-search-field";
import { useWorkspaceUrl } from "./use-workspace-url";

/**
 * The chrome above the workspace.
 *
 * The search box reads `q` from the URL, which is request data, so it sits in
 * its own boundary rather than making the whole header dynamic. Everything else
 * here — the buttons, the layout — is static and ships in the shell.
 */
export function Topbar({
  onNewTask,
  onRefresh,
  isRefreshing,
}: {
  onNewTask: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <React.Suspense fallback={<SearchBoxFallback />}>
          <SearchField />
        </React.Suspense>
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

function SearchField() {
  const { filters, replaceSearch } = useWorkspaceUrl();
  const commit = React.useCallback(
    (q: string) => replaceSearch(q),
    [replaceSearch],
  );
  const field: SearchFieldValue = useDebouncedSearchField(filters.q, commit);

  return (
    <input
      value={field.value}
      onChange={field.onChange}
      onCompositionEnd={field.onCompositionEnd}
      placeholder="Search tasks, labels…"
      className={SEARCH_BOX_CLASS}
    />
  );
}

/**
 * The box at its real size, and not an `<input>`.
 *
 * A second input carrying the same placeholder would be a second element with
 * the same accessible name for as long as the boundary is unresolved — one that
 * cannot be typed into. Holding the space is the whole job here.
 */
function SearchBoxFallback() {
  return <div className={SEARCH_BOX_CLASS} aria-hidden />;
}

const SEARCH_BOX_CLASS =
  "h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring/30";
