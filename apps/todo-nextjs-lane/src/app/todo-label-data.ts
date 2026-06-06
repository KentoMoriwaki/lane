"use client";

import { createLane } from "@lane/lane";
import type { AppType, Label } from "@lane/todo-api";
import { hc } from "hono/client";

const apiUrl = process.env.NEXT_PUBLIC_TODO_API_URL ?? "http://localhost:4000";
const client = hc<AppType>(apiUrl);
const labelLimit = "500";

export const labelLane = createLane();
export const labelsKey = ["labels", { limit: labelLimit }] as const;

export async function fetchLabels() {
  const response = await client.labels.$get(
    {
      query: {
        limit: labelLimit,
      },
    },
    {
      init: {
        cache: "no-store",
      },
    },
  );

  await assertOk(response);
  return (await response.json()) as Label[];
}

export async function postLabel(name: string) {
  const response = await client.labels.$post(
    {
      json: {
        name,
      },
    },
    {
      init: {
        cache: "no-store",
      },
    },
  );

  await assertOk(response);
  return (await response.json()) as Label;
}

async function assertOk(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}) {
  if (response.ok) {
    return;
  }

  const fallback = `Request failed with ${response.status}`;
  const body = await response.text();

  if (!body) {
    throw new Error(fallback);
  }

  let data: { error?: unknown } | null = null;

  try {
    data = JSON.parse(body) as { error?: unknown };
  } catch {
    // Keep the raw response body for non-JSON errors.
  }

  if (typeof data?.error === "string") {
    throw new Error(data.error);
  }

  throw new Error(body);
}
