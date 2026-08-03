"use client";

import type { TeamSummary } from "@/server/api";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";
import { buildWorkspaceHref, EMPTY_VIEW_STATE } from "@/app/lane/api/url-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IntentPrefetchLink } from "./intent-prefetch-link";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function TeamSwitcher({
  teams,
  activeTeamId,
}: {
  teams: TeamSummary[];
  activeTeamId: string;
}) {
  const pathname = usePathname();
  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const hrefForTeam = React.useCallback(
    (teamId: string) =>
      buildWorkspaceHref(pathname, EMPTY_VIEW_STATE, { teamId }),
    [pathname],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sage/15 text-[11px] font-bold text-sage">
          {active ? teamInitials(active.name) : "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {active?.name ?? "No team"}
          </span>
          <span className="truncate text-xs capitalize text-muted-foreground">
            {active?.role ?? "—"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[15rem]" align="start">
        <DropdownMenuLabel>Switch team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {teams.map((team) => (
          <DropdownMenuItem key={team.id} asChild className="gap-2.5">
            <IntentPrefetchLink href={hrefForTeam(team.id)} scroll={false}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sage/15 text-[11px] font-bold text-sage">
                {teamInitials(team.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {team.name}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3" />
                  {team.memberCount} · {team.role}
                </span>
              </span>
              {team.id === active?.id ? (
                <Check className="size-4 text-cobalt" />
              ) : null}
            </IntentPrefetchLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
