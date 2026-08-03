import { ClientOnlyReactQueryWorkspace } from "@/app/react-query/workspace/client-only-workspace";

// Navigation can commit the static workspace shell without waiting for any
// data. The browser starts every React Query read after hydration.
export const instant = true;

export default function Page() {
  return <ClientOnlyReactQueryWorkspace />;
}
