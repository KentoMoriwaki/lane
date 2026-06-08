import * as React from "react";
import { avatarAccent } from "@/lib/accent";
import { cn } from "@/lib/utils";

const sizeClasses = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
} as const;

export interface AvatarProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  initials: string;
  color?: string | null;
  size?: keyof typeof sizeClasses;
}

/**
 * Initials avatar tinted with the member's palette token. This mock app has no
 * uploaded photos, so a calm colored monogram reads better than a generic icon.
 */
export function Avatar({
  initials,
  color,
  size = "md",
  className,
  ...props
}: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase ring-1 ring-inset ring-black/5",
        avatarAccent(color),
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {initials}
    </span>
  );
}
