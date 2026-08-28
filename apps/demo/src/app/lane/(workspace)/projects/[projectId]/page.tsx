import { TaskContextPage } from "@/app/lane/workspace/task-context-page";

export const instant = true;

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** A project is a first-class workspace view, separate from named Contexts. */
export default function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  return (
    <TaskContextPage
      projectParams={params}
      searchParams={searchParams}
    />
  );
}
