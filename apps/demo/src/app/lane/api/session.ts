import { cache } from "react";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { readCurrentUser, readTeams } from "./route-reads";

/**
 * Who is asking, resolved once per render pass.
 *
 * Every region resolves this independently — that is the price of moving the
 * reads down into the regions, and it is the right price: nothing above the
 * region boundaries awaits anything, so the frame stays static and ships in the
 * shell. `cache` is what keeps that from costing one `/api/me` per region.
 *
 * It takes no arguments on purpose. `cache` keys on argument identity, so a
 * `ctx` object built at each call site would miss every time; with no arguments
 * there is one entry per render pass and every caller hits it.
 */
export const getSession = cache(async () => {
  const user = await readCurrentUser("");

  return user;
});

/** The roster, for the team switcher and for validating a team named by the URL. */
export const getTeams = cache(async () => {
  const user = await getSession();

  return readTeams(user.id);
});

/**
 * The context the API reads its headers from, for the team the URL asked for.
 *
 * Cached on the team id rather than on a constructed object, for the same
 * reason `getSession` takes nothing: a fresh `{ userId, teamId }` per region
 * would defeat every downstream `cache` that keys on it.
 */
export const getWorkspaceCtx = cache(
  async (requestedTeamId: string | null): Promise<WorkspaceCtx> => {
    const user = await getSession();

    return {
      userId: user.id,
      teamId: requestedTeamId ?? user.defaultTeamId,
    };
  },
);
