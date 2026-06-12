export type DueTone = "overdue" | "today" | "soon" | "normal" | "none";

export type DueInfo = {
  label: string;
  tone: DueTone;
};

const DAY = 86_400_000;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Human due-date label plus a tone so the UI can color overdue / due-soon work
 * without re-deriving the rules at each call site.
 */
export function describeDueDate(
  iso: string | null,
  isClosed = false,
): DueInfo {
  if (!iso) {
    return { label: "No date", tone: "none" };
  }

  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) {
    return { label: "No date", tone: "none" };
  }

  const today = startOfDay(Date.now());
  const dueDay = startOfDay(due);
  const diffDays = Math.round((dueDay - today) / DAY);

  const label = formatShortDate(iso);

  if (isClosed) {
    return { label, tone: "normal" };
  }

  if (diffDays < 0) {
    return { label, tone: "overdue" };
  }
  if (diffDays === 0) {
    return { label: "Today", tone: "today" };
  }
  if (diffDays === 1) {
    return { label: "Tomorrow", tone: "soon" };
  }
  if (diffDays <= 7) {
    return { label, tone: "soon" };
  }
  return { label, tone: "normal" };
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatLongDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatShortDate(iso);
}

/** `2026-06-07` for native date inputs. */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Date input value (`2026-06-07`) back to an ISO string, or null. */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
