"use client";

import { useLaneInstance } from "use-lane";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useTeams } from "@/app/lane-spa/api/hooks";
import { TEAM_SCOPED_KEYS } from "@/app/lane-spa/api/lane-reads";
import { buildWorkspaceHref, EMPTY_VIEW_STATE } from "@/app/lane-spa/api/url-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "./workspace-provider";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function TeamSwitcher() {
  const { setActiveTeamId } = useWorkspace();

  if (setActiveTeamId) {
    return <ClientTeamSwitcher setActiveTeamId={setActiveTeamId} />;
  }

  return <UrlTeamSwitcher />;
}

function UrlTeamSwitcher() {
  const pathname = usePathname();
  const { activeTeamId } = useWorkspace();
  const lane = useLaneInstance();
  const teams = React.use(useTeams().promise).data;

  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const hrefForTeam = React.useCallback(
    (teamId: string) =>
      buildWorkspaceHref(pathname, EMPTY_VIEW_STATE, { teamId }),
    [pathname],
  );
  const prepareTeamSwitch = React.useCallback(
    (teamId: string) => {
      if (teamId === activeTeamId) {
        return;
      }

      for (const key of TEAM_SCOPED_KEYS) {
        lane.removeAll(key);
      }
    },
    [activeTeamId, lane],
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
            asChild
            className="gap-2.5"
          >
            <Link
              href={hrefForTeam(team.id)}
              prefetch={false}
              scroll={false}
              onClick={() => prepareTeamSwitch(team.id)}
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

function ClientTeamSwitcher({
  setActiveTeamId,
}: {
  setActiveTeamId: (teamId: string) => void;
}) {
  const { activeTeamId } = useWorkspace();
  const lane = useLaneInstance();
  const teams = React.use(useTeams().promise).data;
  const active = teams.find((team) => team.id === activeTeamId) ?? teams[0];

  const switchTeam = React.useCallback(
    (teamId: string) => {
      if (teamId === activeTeamId) {
        return;
      }

      for (const key of TEAM_SCOPED_KEYS) {
        lane.removeAll(key);
      }

      setActiveTeamId(teamId);
    },
    [activeTeamId, lane, setActiveTeamId],
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
            onSelect={() => switchTeam(team.id)}
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
