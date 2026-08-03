import { ClientOnlyWorkspaceApp } from "@/app/lane-spa/workspace/client-only-workspace";

// The static workspace shell can commit before the browser starts Lane reads.
export const instant = true;

export default function Page() {
  return <ClientOnlyWorkspaceApp />;
}
