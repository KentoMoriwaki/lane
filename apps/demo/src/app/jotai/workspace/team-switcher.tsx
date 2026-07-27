"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import * as React from "react";
import { activeTeamIdAtom, switchTeamAtom } from "@/app/jotai/api/atoms";
import { useTeams } from "@/app/jotai/api/hooks";
import { useWorkspaceTransition } from "@/app/jotai/api/workspace-transition";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function TeamSwitcher() {
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const switchTeam = useSetAtom(switchTeamAtom);
  const { startTransition } = useWorkspaceTransition();
  const teams = useTeams();

  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];

  /**
   * Switching teams is one atom write. Nothing is evicted first: the team is
   * part of the scope every team-scoped read depends on, so they all re-run,
   * and inside a transition the current team's workspace stays on screen until
   * the next one is ready.
   */
  const selectTeam = React.useCallback(
    (teamId: string) => {
      startTransition(() => {
        switchTeam(teamId);
      });
    },
    [startTransition, switchTeam],
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
          <DropdownMenuItem
            key={team.id}
            className="gap-2.5"
            onSelect={() => selectTeam(team.id)}
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
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
