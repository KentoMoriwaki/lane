import type { TaskPriority, TaskStatus } from "@/server/api";
import {
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Eye,
  type LucideIcon,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Timer,
} from "lucide-react";
import type { AccentToken } from "./accent";

export type StatusMeta = {
  value: TaskStatus;
  label: string;
  icon: LucideIcon;
  accent: AccentToken;
  group: "open" | "closed";
};

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: {
    value: "backlog",
    label: "Backlog",
    icon: CircleDashed,
    accent: "slate",
    group: "open",
  },
  todo: {
    value: "todo",
    label: "Todo",
    icon: Circle,
    accent: "slate",
    group: "open",
  },
  in_progress: {
    value: "in_progress",
    label: "In progress",
    icon: Timer,
    accent: "amber",
    group: "open",
  },
  in_review: {
    value: "in_review",
    label: "In review",
    icon: Eye,
    accent: "cobalt",
    group: "open",
  },
  done: {
    value: "done",
    label: "Done",
    icon: CircleCheck,
    accent: "sage",
    group: "closed",
  },
  canceled: {
    value: "canceled",
    label: "Canceled",
    icon: CircleX,
    accent: "slate",
    group: "closed",
  },
};

export const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "in_review",
  "todo",
  "backlog",
  "done",
  "canceled",
];

export type PriorityMeta = {
  value: TaskPriority;
  label: string;
  icon: LucideIcon;
  accent: AccentToken;
};

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  urgent: { value: "urgent", label: "Urgent", icon: AlertTriangle, accent: "rose" },
  high: { value: "high", label: "High", icon: SignalHigh, accent: "rose" },
  medium: { value: "medium", label: "Medium", icon: SignalMedium, accent: "amber" },
  low: { value: "low", label: "Low", icon: SignalLow, accent: "cobalt" },
  none: { value: "none", label: "No priority", icon: Minus, accent: "slate" },
};

export const PRIORITY_ORDER: TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const PRIORITY_GROUP_ORDER: TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export { CircleDot };
