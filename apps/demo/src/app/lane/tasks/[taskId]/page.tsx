import { DirectTaskRouteBootstrap } from "@/app/lane/workspace/task-route-bootstrap";
import {
  LANE_PATH,
  workspaceQueryFromRecord,
} from "@/app/lane/workspace/workspace-context";

export const instant = false;

type CanonicalTaskPageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Establish All tasks before reopening this URL through the workspace slot. */
export default async function CanonicalTaskPage({
  params,
  searchParams,
}: CanonicalTaskPageProps) {
  const [{ taskId }, record] = await Promise.all([params, searchParams]);
  const search = workspaceQueryFromRecord(record);

  return (
    <DirectTaskRouteBootstrap
      taskId={taskId}
      listHref={`${LANE_PATH}${search ? `?${search}` : ""}`}
    />
  );
}
