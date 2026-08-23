import type { ReactNode } from "react";
import { OwnerAskShell } from "./shell";

export default function OwnerAskLayout({ children }: { children: ReactNode }) {
  return <OwnerAskShell>{children}</OwnerAskShell>;
}
