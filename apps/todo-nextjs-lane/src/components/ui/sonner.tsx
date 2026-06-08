"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-border !bg-surface !text-foreground !shadow-xl !shadow-foreground/10",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
          error: "!text-rose",
          success: "!text-sage",
        },
      }}
    />
  );
}
