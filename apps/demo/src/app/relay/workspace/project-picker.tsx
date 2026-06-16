"use client";

import { Check, ChevronsUpDown, FolderPlus, Hash } from "lucide-react";
import * as React from "react";
import { graphql, useLazyLoadQuery } from "react-relay";
import { toast } from "sonner";
import { useCreateProject } from "@/app/relay/api/mutations";
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
import { accent } from "@/lib/accent";
import { cn } from "@/lib/utils";
import type { projectPickerQuery } from "@/app/relay/__generated__/projectPickerQuery.graphql";
import { InlineSpinner } from "./feedback";

const PROJECT_COLORS = ["cobalt", "sage", "amber", "rose", "slate"];

const projectsQuery = graphql`
  query projectPickerQuery {
    projects {
      id
      name
      color
      taskCount
    }
  }
`;

export type PickerProject = { id: string; name: string; color: string };

export function ProjectPicker({
  value,
  selected,
  changeAction,
  pending,
  disabled,
}: {
  value: string | null;
  selected: { name: string; color: string } | null;
  changeAction: (project: PickerProject | null) => void;
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
              <span
                className={cn("size-2 rounded-full", accent(selected.color).dot)}
              />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Hash className="size-4" />
              No project
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
        {open ? (
          <React.Suspense fallback={<OptionsFallback />}>
            <ProjectOptions
              value={value}
              onPick={(project) => {
                changeAction(project);
                setOpen(false);
              }}
            />
          </React.Suspense>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ProjectOptions({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (project: PickerProject | null) => void;
}) {
  const [listKey, setListKey] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const createProject = useCreateProject();
  const [isCreating, startCreate] = React.useTransition();
  const { projects } = useLazyLoadQuery<projectPickerQuery>(
    projectsQuery,
    {},
    { fetchPolicy: "store-or-network", fetchKey: listKey },
  );

  const trimmed = search.trim();
  const exactMatch = projects.some(
    (project) => project.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactMatch;

  function handleCreate() {
    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    startCreate(async () => {
      try {
        const project = await createProject({ name: trimmed, color });
        setListKey((key) => key + 1);
        onPick({ id: project.id, name: project.name, color: project.color });
        toast.success(`Project “${project.name}” created`);
      } catch (error) {
        toast.error("Couldn't create project", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  return (
    <Command>
      <CommandInput
        placeholder="Search or create project…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No matching project.</CommandEmpty>
        <CommandGroup>
          <CommandItem value="__no_project__" onSelect={() => onPick(null)}>
            <Hash className="size-4 text-muted-foreground" />
            <span className="flex-1">No project</span>
            {value === null ? <Check className="size-4 text-cobalt" /> : null}
          </CommandItem>
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={project.name}
              onSelect={() =>
                onPick({
                  id: project.id,
                  name: project.name,
                  color: project.color,
                })
              }
            >
              <span
                className={cn("size-2 rounded-full", accent(project.color).dot)}
              />
              <span className="flex-1 truncate">{project.name}</span>
              <span className="text-xs text-muted-foreground">
                {project.taskCount}
              </span>
              {value === project.id ? (
                <Check className="size-4 text-cobalt" />
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
        {canCreate ? (
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm text-cobalt transition-colors hover:bg-accent disabled:opacity-60"
          >
            {isCreating ? <InlineSpinner /> : <FolderPlus className="size-4" />}
            Create “{trimmed}”
          </button>
        ) : null}
      </CommandList>
    </Command>
  );
}

function OptionsFallback() {
  return (
    <div className="flex items-center justify-center py-6">
      <InlineSpinner className="text-muted-foreground" />
    </div>
  );
}
