import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/app/react-query/components/ui/button";
import { cn } from "@/app/react-query/lib/utils";

/** Scoped error with a retry control — never a full-page failure. */
export function SectionError({
  title = "Couldn't load this",
  message,
  onRetry,
  isRetrying,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-rose/30 bg-rose/5 p-4 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-medium text-rose">
        <AlertTriangle className="size-4" />
        {title}
      </div>
      {message ? (
        <p className="text-muted-foreground">{message}</p>
      ) : null}
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {message ? (
          <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}
