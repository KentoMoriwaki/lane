import { TaskPanelRoute } from "@/app/lane/workspace/task-route-page";

export const instant = true;

type InterceptedTaskProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Open the canonical task beside whichever workspace list is active. */
export default function InterceptedTaskPanel(props: InterceptedTaskProps) {
  return <TaskPanelRoute {...props} />;
}
