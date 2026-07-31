import type { ReactNode } from "react";
import { BfcacheShell } from "./shell";

export default function BfcacheLayout({ children }: { children: ReactNode }) {
  return <BfcacheShell>{children}</BfcacheShell>;
}
