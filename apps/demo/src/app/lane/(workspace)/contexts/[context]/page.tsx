import { TaskContextPage } from "@/app/lane/workspace/task-context-page";
import {
  STATIC_WORKSPACE_CONTEXT_KEYS,
} from "@/app/lane/workspace/workspace-context";

export const instant = true;

export function generateStaticParams() {
  return STATIC_WORKSPACE_CONTEXT_KEYS.map((context) => ({ context }));
}

type ContextPageProps = {
  params: Promise<{ context: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ContextPage({
  params,
  searchParams,
}: ContextPageProps) {
  return (
    <TaskContextPage contextParams={params} searchParams={searchParams} />
  );
}
