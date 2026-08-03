"use server";

import { revalidatePath } from "next/cache";

// The Next-layer counterpart to the HUD's lane ops: an explicit, server-side
// declaration that /bfcache/list is stale. What a browser-back restore does
// after this is the measurement — does the bfcache honor Next's own
// invalidation, or is as-is restoration absolute?
export async function revalidateListAction(): Promise<void> {
  revalidatePath("/bfcache/list");
}
