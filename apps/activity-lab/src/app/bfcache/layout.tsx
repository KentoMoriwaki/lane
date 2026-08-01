import type { ReactNode } from "react";
import { BfcacheShell } from "./shell";

export default function BfcacheLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return <BfcacheShell modal={modal}>{children}</BfcacheShell>;
}
