"use client";

import { Check, ChevronsUpDown, Users } from "lucide-react";
import * as React from "react";
import { graphql, useFragment } from "react-relay";
import { useWorkspace } from "@/app/relay/api/workspace-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { teamSwitcher_query$key } from "@/app/relay/__generated__/teamSwitcher_query.graphql";

const teamSwitcherFragment = graphql`
  fragment teamSwitcher_query on Query {
    teams {
      id
      name
      slug
      role
      memberCount
    }
  }
`;

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function TeamSwitcher({ query }: { query: teamSwitcher_query$key }) {
  const { teams } = useFragment(teamSwitcherFragment, query);
  const { activeTeamId, setActiveTeamId } = useWorkspace();

  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];

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
            onSelect={() => {
              if (team.id !== active?.id) {
                // A new environment + store for the new team; the workspace
                // re-fetches against it.
                setActiveTeamId(team.id);
              }
            }}
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
