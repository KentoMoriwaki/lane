"use client";

import { useSetAtom } from "jotai";
import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  Inbox,
  type LucideIcon,
  LogOut,
  Tag,
  UserCircle2,
  UserX,
} from "lucide-react";
import * as React from "react";
import { signOutAtom } from "@/app/jotai/api/atoms";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/jotai/api/endpoints";
import {
  useCurrentUser,
  useInsights,
  useLabels,
  useProjects,
} from "@/app/jotai/api/hooks";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accent } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { TeamSwitcher } from "./team-switcher";

function activeKey(f: TaskFilters): string {
  if (f.projectId) return `project:${f.projectId}`;
  if (f.labelId) return `label:${f.labelId}`;
  if (f.due === "overdue") return "overdue";
  if (f.due === "week") return "due-soon";
  if (f.status.length === 1 && f.status[0] === "done") return "completed";
  if (f.scope === "mine") return "mine";
  if (f.scope === "unassigned") return "unassigned";
  if (
    f.scope === "all" &&
    f.status.length === 0 &&
    !f.due &&
    !f.q &&
    f.priority.length === 0
  ) {
    return "all";
  }
  return "";
}

export function Sidebar({
  filters,
  onViewChange,
}: {
  filters: TaskFilters;
  onViewChange: (view: Partial<TaskFilters>) => void;
}) {
  const active = activeKey(filters);
  // Four reads, four atoms. Nothing here branches on a status: the component
  // renders once all four have resolved, and the Suspense boundary above owns
  // the wait.
  const user = useCurrentUser();
  const insights = useInsights();
  const projects = useProjects();
  const labels = useLabels();
  const signOut = useSetAtom(signOutAtom);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-sage text-sm font-bold text-primary-foreground">
          L
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Lane
        </span>
      </div>

      <div className="px-3 pb-2">
        <TeamSwitcher />
      </div>

      <nav className="scrollbar-calm flex-1 space-y-5 overflow-y-auto px-2 py-2">
        <NavGroup>
          <NavItem
            icon={Inbox}
            label="All tasks"
            isActive={active === "all"}
            onSelect={() => onViewChange(EMPTY_FILTERS)}
          />
          <NavItem
            icon={UserCircle2}
            label="My tasks"
            count={insights.assignedToMe}
            isActive={active === "mine"}
            onSelect={() => onViewChange({ scope: "mine" })}
          />
          <NavItem
            icon={UserX}
            label="Unassigned"
            count={insights.unassigned}
            isActive={active === "unassigned"}
            onSelect={() => onViewChange({ scope: "unassigned" })}
          />
          <NavItem
            icon={AlertTriangle}
            label="Overdue"
            count={insights.overdue}
            tone="rose"
            isActive={active === "overdue"}
            onSelect={() => onViewChange({ due: "overdue" })}
          />
          <NavItem
            icon={CalendarClock}
            label="Due soon"
            count={insights.dueSoon}
            isActive={active === "due-soon"}
            onSelect={() => onViewChange({ due: "week" })}
          />
          <NavItem
            icon={CircleCheck}
            label="Completed"
            count={insights.completed}
            isActive={active === "completed"}
            onSelect={() => onViewChange({ status: ["done"] })}
          />
        </NavGroup>

        <NavSection title="Projects">
          {projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No projects yet
            </p>
          ) : (
            projects.map((project) => (
              <NavItem
                key={project.id}
                dotClass={accent(project.color).dot}
                label={project.name}
                count={project.taskCount}
                isActive={active === `project:${project.id}`}
                onSelect={() => onViewChange({ projectId: project.id })}
              />
            ))
          )}
        </NavSection>

        <NavSection title="Labels">
          {labels.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No labels yet
            </p>
          ) : (
            labels.map((label) => (
              <NavItem
                key={label.id}
                dotClass={accent(label.color).dot}
                label={label.name}
                isActive={active === `label:${label.id}`}
                onSelect={() => onViewChange({ labelId: label.id })}
              />
            ))
          )}
        </NavSection>
      </nav>

      <div className="border-t border-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
            <Avatar size="md" initials={user.initials} color={user.color} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[14rem]">
            <DropdownMenuItem disabled>{user.email}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="text-rose focus:bg-rose/10 focus:text-rose [&_svg]:text-rose"
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function NavGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

function NavSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Tag className="size-3" />
        {title}
      </p>
      {children}
    </div>
  );
}

function NavItem({
  icon: Icon,
  dotClass,
  label,
  count,
  tone,
  isActive,
  onSelect,
}: {
  icon?: LucideIcon;
  dotClass?: string;
  label: string;
  count?: number;
  tone?: "rose";
  isActive?: boolean;
  onSelect: () => void;
}) {
  const active = Boolean(isActive);

  return (
    <button type="button" className="block w-full rounded-md" onClick={onSelect}>
      <span
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
          active
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              tone === "rose" && (count ?? 0) > 0 ? "text-rose" : undefined,
            )}
          />
        ) : (
          <span className={cn("size-2 shrink-0 rounded-full", dotClass)} />
        )}
        <span className="flex-1 truncate text-left">{label}</span>
        {typeof count === "number" && count > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </span>
    </button>
  );
}
