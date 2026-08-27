import { TaskContextPage } from "@/app/lane/workspace/task-context-page";

export const instant = true;

export default function CompletedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <TaskContextPage contextKey="completed" searchParams={searchParams} />
  );
}
