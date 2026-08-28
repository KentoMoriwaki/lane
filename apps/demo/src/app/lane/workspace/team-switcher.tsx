"use client";

import { Check, ChevronsUpDown, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useTeams } from "@/app/lane/api/hooks";
import { buildWorkspaceHref, EMPTY_VIEW_STATE } from "@/app/lane/api/url-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveTeamId } from "./workspace-provider";
import { LANE_PATH } from "./workspace-context";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function TeamSwitcher() {
  const activeTeamId = useActiveTeamId();
  const teams = React.use(useTeams().promise).data;

  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const hrefForTeam = React.useCallback(
    (teamId: string) =>
      buildWorkspaceHref(LANE_PATH, EMPTY_VIEW_STATE, { teamId }),
    [],
  );
  // A team is the outer workspace context, so switching it always lands on the
  // cross-project list. Carrying a project route across teams could name a
  // project that does not exist there. No eviction step is needed: the route
  // republishes every workspace key for the new team into this server-owned
  // lane.

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
          <DropdownMenuItem
            key={team.id}
            asChild
            className="gap-2.5"
          >
            <Link
              href={hrefForTeam(team.id)}
              scroll={false}
            >
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
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
