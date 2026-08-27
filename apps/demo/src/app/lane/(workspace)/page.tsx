import { TaskContextPage } from "@/app/lane/workspace/task-context-page";

// The route claims its navigations produce a UI immediately. Nothing below may
// await above a Suspense boundary, or the claim fails validation.
export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * **The server-owned variant.** Every workspace key is published by this route
 * and read with `external` — a loader that waits for the publication rather
 * than fetching anything itself.
 *
 * This component awaits nothing, which is the whole point. `searchParams` and
 * every read are resolved inside the regions, below their own boundaries. The
 * shared route-group layout keeps the sidebar and topbar mounted, while the
 * page-specific toolbar and task list stream independently.
 *
 * **The detail is not here any more.** A task is its own route
 * (`task/[id]/page.tsx`), and a row is a `<Link>` to it. Clicking one is
 * intercepted into the `@modal` slot, which the root `layout.tsx` draws beside
 * this list; opening the same URL directly renders the full page instead.
 *
 * Mutations arrive by two channels, and only one of them ends here. Creating
 * something calls a Server Action, whose response *is* this route rendered
 * again — the new task comes back already in its sorted place. Editing a task
 * calls the API from the browser and lands the whole answer in the lane: the
 * row, and the counters the write recomputed after it. **That channel never
 * renders this file.** Neither needs the other to know what it did (see
 * `api/hooks.ts`).
 *
 * `/lane-spa` is the same workspace with the opposite answer: no seeding,
 * client loaders, and the cache maintenance that comes with owning your data.
 */
export default function Page({ searchParams }: PageProps) {
  return <TaskContextPage contextKey="all" searchParams={searchParams} />;
}
