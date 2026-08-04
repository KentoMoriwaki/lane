"use client";

import { Check, ChevronsUpDown, UserCircle2, UserX } from "lucide-react";
import * as React from "react";
import { graphql, useLazyLoadQuery } from "react-relay";
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
import { cn } from "@/lib/utils";
import type { assigneePickerQuery } from "@/app/relay/__generated__/assigneePickerQuery.graphql";
import { InlineSpinner } from "./feedback";

const membersQuery = graphql`
  query assigneePickerQuery {
    members {
      id
      name
      email
      initials
      color
      role
    }
  }
`;

export type PickerMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export function AssigneePicker({
  value,
  selected,
  changeAction,
  pending,
  disabled,
}: {
  value: string | null;
  selected: { name: string; initials: string; color: string } | null;
  changeAction: (member: PickerMember | null) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

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
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <React.Suspense fallback={<OptionsFallback />}>
              {open ? (
                <AssigneeOptions
                  value={value}
                  pickAction={(member) => {
                    changeAction(member);
                    setOpen(false);
                  }}
                />
              ) : null}
            </React.Suspense>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AssigneeOptions({
  value,
  pickAction,
}: {
  value: string | null;
  pickAction: (member: PickerMember | null) => void;
}) {
  const { members } = useLazyLoadQuery<assigneePickerQuery>(
    membersQuery,
    {},
    { fetchPolicy: "store-or-network" },
  );

  return (
    <>
      <CommandEmpty>No teammates found.</CommandEmpty>
      <CommandGroup>
        <CommandItem
          value="unassigned no-assignee"
          onSelect={() => pickAction(null)}
        >
          <UserX className="size-4 text-muted-foreground" />
          <span className="flex-1">Unassigned</span>
          {value === null ? <Check className="size-4 text-cobalt" /> : null}
        </CommandItem>
        {members.map((member) => (
          <CommandItem
            key={member.id}
            value={`${member.name} ${member.email}`}
            onSelect={() =>
              pickAction({
                id: member.id,
                name: member.name,
                initials: member.initials,
                color: member.color,
              })
            }
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
  );
}

function OptionsFallback() {
  return (
    <div className="flex items-center justify-center py-6">
      <InlineSpinner className="text-muted-foreground" />
    </div>
  );
}
