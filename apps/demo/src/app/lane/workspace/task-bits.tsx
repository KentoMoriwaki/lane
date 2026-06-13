import type { TaskPriority, TaskStatus, TeamLabel } from "@lane/todo-api";
import { CalendarClock } from "lucide-react";
import { accent } from "@/app/lane/lib/accent";
import { type DueTone, describeDueDate } from "@/app/lane/lib/format";
import { PRIORITY_META, STATUS_META } from "@/app/lane/lib/task-meta";
import { cn } from "@/app/lane/lib/utils";

export function StatusIcon({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return <Icon className={cn("size-4", accent(meta.accent).text, className)} />;
}

export function StatusLabel({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusIcon status={status} />
      <span>{meta.label}</span>
    </span>
  );
}

export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return <Icon className={cn("size-4", accent(meta.accent).text, className)} />;
}

export function LabelChip({
  label,
  className,
}: {
  label: TeamLabel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", accent(label.color).dot)} />
      {label.name}
    </span>
  );
}

const dueToneClasses: Record<DueTone, string> = {
  overdue: "text-rose",
  today: "text-amber",
  soon: "text-amber",
  normal: "text-muted-foreground",
  none: "text-muted-foreground/70",
};

export function DueBadge({
  dueDate,
  isClosed,
  withIcon = true,
  className,
}: {
  dueDate: string | null;
  isClosed?: boolean;
  withIcon?: boolean;
  className?: string;
}) {
  const info = describeDueDate(dueDate, isClosed);
  if (info.tone === "none" && !withIcon) {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        dueToneClasses[info.tone],
        className,
      )}
    >
      {withIcon ? <CalendarClock className="size-3.5" /> : null}
      {info.label}
    </span>
  );
}
