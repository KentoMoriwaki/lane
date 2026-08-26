"use client";

import { FolderKanban } from "lucide-react";
import * as React from "react";
import {
  useProjectCounts,
  useProjects,
} from "@/app/lane/api/hooks";
import { accent } from "@/lib/accent";
import { cn } from "@/lib/utils";

export function ProjectHeader({ projectId }: { projectId: string }) {
  const projects = React.use(useProjects().promise).data;
  const projectCounts = React.use(useProjectCounts().promise).data;
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    return (
      <div className="flex min-h-[92px] items-center gap-3 border-b border-border bg-surface px-4 py-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FolderKanban className="size-5" />
        </div>
        <div>
          <h1 className="font-semibold text-foreground">Project not found</h1>
          <p className="text-sm text-muted-foreground">
            This project does not belong to the active team.
          </p>
        </div>
      </div>
    );
  }

  const taskCount = projectCounts[project.id] ?? 0;

  return (
    <div
      data-testid="project-header"
      className="flex min-h-[92px] items-center gap-3 border-b border-border bg-surface px-4 py-4"
    >
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-background">
        <span className={cn("size-2.5 rounded-full", accent(project.color).dot)} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-foreground">
            {project.name}
          </h1>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {project.key}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Project workspace</p>
      </div>
      <div className="ml-auto rounded-lg border border-border bg-background px-3 py-2 text-right">
        <div className="text-lg font-semibold tabular-nums text-foreground">
          {taskCount}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {taskCount === 1 ? "task" : "tasks"}
        </div>
      </div>
    </div>
  );
}
