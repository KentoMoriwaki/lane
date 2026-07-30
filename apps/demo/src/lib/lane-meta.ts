/**
 * What every loader in this app is handed besides its key.
 *
 * `LaneRegister` is declared **once per app**, not once per feature — the meta
 * travels with the lane, and TypeScript resolves the augmentation across the
 * whole program. That is why this lives here rather than in either workspace's
 * `api/client.ts`: both of them read it, and two declarations of one property
 * would collide.
 *
 * It is also why the three single-purpose demos (`/cancel`, `/infinite`,
 * `/lane-router`) pass {@link NO_SESSION} below. They mount their own lanes and
 * their fetchers take no session at all, but this app has declared that a lane
 * carries one, so every lane supplies one. In a real app — one session type, one
 * kind of lane — that uniformity is the point; here it is the visible cost of
 * hosting six unrelated examples in a single TypeScript program.
 */
export type WorkspaceCtx = {
  userId: string;
  teamId: string;
};

declare module "use-lane" {
  interface LaneRegister {
    loaderMeta: WorkspaceCtx;
  }
}

/**
 * The meta for a lane with no session behind it. The demos that use it never
 * read it — their loaders take a cursor or a query string and nothing else — so
 * the empty ids never reach a request.
 */
export const NO_SESSION: WorkspaceCtx = { teamId: "", userId: "" };
