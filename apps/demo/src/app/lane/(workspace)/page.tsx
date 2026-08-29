import { redirect } from "next/navigation";
import {
  LANE_PATH,
  workspaceQueryFromRecord,
} from "@/app/lane/workspace/workspace-context";

export const instant = false;

/** Keep old `/lane` links useful while making All tasks an explicit Context. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const record = await searchParams;
  const search = workspaceQueryFromRecord(record);
  redirect(`${LANE_PATH}${search ? `?${search}` : ""}`);
}
