"use client";

import type { Project } from "@lane/todo-api";
import { Check, ChevronsUpDown, FolderPlus, Hash } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useCreateProject, useProjects } from "@/app/lane/api/hooks";
import { ApiError } from "@/app/lane/api/client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/app/lane/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/lane/components/ui/popover";
import { accent } from "@/app/lane/lib/accent";
import { cn } from "@/app/lane/lib/utils";
import { InlineSpinner } from "./feedback";

const PROJECT_COLORS = ["cobalt", "sage", "amber", "rose", "slate"];

export function ProjectPicker({
  value,
  changeAction,
  pending,
  disabled,
}: {
  value: string | null;
  changeAction: (projectId: string | null) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const projects = React.use(useProjects().promise);
  const createProject = useCreateProject();
  const [isCreating, startCreateTransition] = React.useTransition();

  const selected: Project | null =
    projects.find((project) => project.id === value) ?? null;

  const trimmed = search.trim();
  const exactMatch = projects.some(
    (project) => project.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactMatch;

  function handleCreate() {
    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    startCreateTransition(async () => {
      try {
        const project = await createProject({ name: trimmed, color });
        changeAction(project.id);
        setSearch("");
        setOpen(false);
        toast.success(`Project “${project.name}” created`);
      } catch (error) {
        if (error instanceof ApiError && error.isForbidden) {
          toast.error("Only team admins can create projects", {
            description: "Ask an admin to add this project.",
          });
        } else {
          toast.error("Couldn't create project", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }
    });
  }

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
                className={cn(
                  "size-2 rounded-full",
                  accent(selected.color).dot,
                )}
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
        <Command>
          <CommandInput
            placeholder="Search or create project…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No matching project.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__no_project__"
                onSelect={() => {
                  changeAction(null);
                  setOpen(false);
                }}
              >
                <Hash className="size-4 text-muted-foreground" />
                <span className="flex-1">No project</span>
                {value === null ? <Check className="size-4 text-cobalt" /> : null}
              </CommandItem>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.name}
                  onSelect={() => {
                    changeAction(project.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      accent(project.color).dot,
                    )}
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
                {isCreating ? (
                  <InlineSpinner />
                ) : (
                  <FolderPlus className="size-4" />
                )}
                Create “{trimmed}”
              </button>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
