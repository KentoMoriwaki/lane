"use client";

import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useWorkspace, useSessionUser } from "./workspace-provider";

export function SignInScreen() {
  const { signIn } = useWorkspace();
  const sessionUser = useSessionUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-xl shadow-foreground/5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-sage text-sm font-bold text-primary-foreground">
            L
          </span>
          <span className="text-base font-semibold tracking-tight">Lane</span>
        </div>

        <h1 className="mt-6 text-lg font-semibold text-foreground">
          You're signed out
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your workspace data was cleared from this device. Sign back in to
          continue.
        </p>

        <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-background/60 p-3">
          <Avatar
            size="lg"
            initials={sessionUser.initials}
            color={sessionUser.color}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {sessionUser.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {sessionUser.email}
            </p>
          </div>
        </div>

        <Button className="mt-5 w-full" onClick={signIn}>
          Continue as {sessionUser.name.split(" ")[0]}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
