"use client";

import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  FolderKanban,
  Inbox,
  type LucideIcon,
  LogOut,
  UserCircle2,
  UserX,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { WorkspaceBrand } from "./brand";
import { useWorkspaceHrefs } from "./use-workspace-hrefs";
import * as React from "react";
import {
  useCurrentUser,
  useInsights,
  useProjectCounts,
  useProjects,
} from "@/app/lane/api/hooks";
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
import { useWorkspace } from "./workspace-provider";

export function Sidebar() {
  const { contextKey, projectId, projectHref, workspaceHref } =
    useWorkspaceHrefs();
  const user = React.use(useCurrentUser().promise).data;
  const insights = React.use(useInsights().promise).data;
  // Two reads for one row of the nav: the project's name and colour come from
  // the roster, while the task-derived number has its own key so a confirmed
  // mutation response can update it independently.
  const projects = React.use(useProjects().promise).data;
  const projectCounts = React.use(useProjectCounts().promise).data;
  const { signOut } = useWorkspace();

  return (
    <aside
      data-testid="sidebar"
      className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex"
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <WorkspaceBrand />
      </div>

      <div className="px-3 pb-2">
        <TeamSwitcher />
      </div>

      <nav className="scrollbar-calm flex-1 space-y-5 overflow-y-auto px-2 py-2">
        <NavGroup>
          <NavItem
            icon={Inbox}
            label="All tasks"
            isActive={contextKey === "all"}
            href={workspaceHref("all")}
          />
          <NavItem
            icon={UserCircle2}
            label="My tasks"
            count={insights.assignedToMe}
            isActive={contextKey === "mine"}
            href={workspaceHref("mine")}
          />
          <NavItem
            icon={UserX}
            label="Unassigned"
            count={insights.unassigned}
            isActive={contextKey === "unassigned"}
            href={workspaceHref("unassigned")}
          />
          <NavItem
            icon={AlertTriangle}
            label="Overdue"
            count={insights.overdue}
            tone="rose"
            isActive={contextKey === "overdue"}
            href={workspaceHref("overdue")}
          />
          <NavItem
            icon={CalendarClock}
            label="Due soon"
            count={insights.dueSoon}
            isActive={contextKey === "due-soon"}
            href={workspaceHref("due-soon")}
          />
          <NavItem
            icon={CircleCheck}
            label="Completed"
            count={insights.completed}
            isActive={contextKey === "completed"}
            href={workspaceHref("completed")}
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
                count={projectCounts[project.id] ?? 0}
                isActive={
                  contextKey === "project" && projectId === project.id
                }
                href={projectHref(project.id)}
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
                onClick={signOut}
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
        <FolderKanban className="size-3" />
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
  href,
}: {
  icon?: LucideIcon;
  dotClass?: string;
  label: string;
  count?: number;
  tone?: "rose";
  isActive?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className="block w-full rounded-md"
    >
      <NavItemContent
        icon={Icon}
        dotClass={dotClass}
        label={label}
        count={count}
        tone={tone}
        isActive={isActive}
      />
    </Link>
  );
}

function NavItemContent({
  icon: Icon,
  dotClass,
  label,
  count,
  tone,
  isActive,
}: {
  icon?: LucideIcon;
  dotClass?: string;
  label: string;
  count?: number;
  tone?: "rose";
  isActive?: boolean;
}) {
  const { pending } = useLinkStatus();
  const active = Boolean(isActive || pending);

  return (
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
  );
}
