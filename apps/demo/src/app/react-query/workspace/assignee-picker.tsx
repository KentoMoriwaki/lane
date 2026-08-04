"use client";

import type { TeamMember } from "@/server/api";
import { Check, ChevronsUpDown, UserCircle2, UserX } from "lucide-react";
import * as React from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar } from "@/components/ui/avatar";
import { useMembers } from "@/app/react-query/api/hooks";
import { cn } from "@/lib/utils";
import { InlineSpinner, SectionError } from "./feedback";

export function AssigneePicker({
  value,
  changeAction,
  pending,
  disabled,
}: {
  value: string | null;
  changeAction: (assigneeId: string | null) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const { data: members, isLoading, isError, refetch, isFetching } =
    useMembers();
  const selected: TeamMember | null =
    members?.find((member) => member.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-2.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
          pending && "opacity-70",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <Avatar
                size="sm"
                initials={selected.initials}
                color={selected.color}
              />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <UserCircle2 className="size-4" />
              Unassigned
            </span>
          )}
        </span>
        {pending ? (
          <InlineSpinner className="text-muted-foreground" />
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {isError ? (
          <div className="p-2">
            <SectionError
              title="Members unavailable"
              onRetry={() => refetch()}
              isRetrying={isFetching}
            />
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Assign to…" />
            <CommandList>
              {isLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <InlineSpinner /> Loading members…
                </div>
              ) : (
                <>
                  <CommandEmpty>No teammates found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="unassigned no-assignee"
                      onSelect={() => {
                        changeAction(null);
                        setOpen(false);
                      }}
                    >
                      <UserX className="size-4 text-muted-foreground" />
                      <span className="flex-1">Unassigned</span>
                      {value === null ? (
                        <Check className="size-4 text-cobalt" />
                      ) : null}
                    </CommandItem>
                    {members?.map((member) => (
                      <CommandItem
                        key={member.id}
                        value={`${member.name} ${member.email}`}
                        onSelect={() => {
                          changeAction(member.id);
                          setOpen(false);
                        }}
                      >
                        <Avatar
                          size="sm"
                          initials={member.initials}
                          color={member.color}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{member.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {member.role === "admin" ? "Admin" : "Member"}
                          </span>
                        </span>
                        {value === member.id ? (
                          <Check className="size-4 text-cobalt" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
