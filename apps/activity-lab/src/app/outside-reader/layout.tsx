import type { ReactNode } from "react";
import { OutsideShell } from "./shell";

export default function OutsideReaderLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <OutsideShell>{children}</OutsideShell>;
}
