"use client";

import { type ComponentType, use } from "react";
import {
  Link,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams,
  useRevalidator,
} from "react-router";
import {
  external,
  laneRead,
  LaneHydration,
  type LaneHydrationSnapshots,
  useLane,
} from "use-lane";
import {
  fetchPosts,
  fetchUser,
  fetchUsers,
  type PostsData,
  promoteFirstPost,
  promoteFirstUser,
  type UserData,
  type UsersData,
  userName,
} from "./api";
import { AppShell, RouteSkeleton } from "./shell";

/**
 * The reads. Every one of them is `external`, which is this route's whole claim:
 * **the router's loaders own this data, and Lane distributes it.** A read here
 * has no fetcher and no freshness policy of its own — both belong to the loader
 * that supplies the key — so what `useLane` does is wait for the publication and
 * hand it over.
 *
 * The keys are the contract between the two halves: a loader publishes
 * `["users"]` (see `usersLoader`), and anything under the boundary reads it by
 * naming it — no props threaded down, no context of its own.
 */
const routeReads = {
  users: () => laneRead<UsersData>({ key: ["users"], loader: external }),
  user: (id: string) =>
    laneRead<UserData>({ key: ["user", id], loader: external }),
  posts: () => laneRead<PostsData>({ key: ["posts"], loader: external }),
};

// ---- loaders: fetch route data, return it as a Lane hydration snapshot -------
export async function usersLoader({
  request,
}: LoaderFunctionArgs): Promise<LaneHydrationSnapshots> {
  const data = await fetchUsers(request.signal);
  return { entries: [{ key: ["users"], data }] };
}

export async function userLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<LaneHydrationSnapshots> {
  const id = params.id!;
  const data = await fetchUser(id, request.signal);
  return { entries: [{ key: ["user", id], data }] };
}

export async function postsLoader({
  request,
}: LoaderFunctionArgs): Promise<LaneHydrationSnapshots> {
  const data = await fetchPosts(request.signal);
  return { entries: [{ key: ["posts"], data }] };
}

// ---- publish the loader's snapshot into Lane, then render the UI ------------
function withHydration(Ui: ComponentType) {
  return function HydratedRoute() {
    const snapshots = useLoaderData() as LaneHydrationSnapshots;
    return (
      <LaneHydration snapshots={snapshots}>
        <Ui />
      </LaneHydration>
    );
  };
}

function Home() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Route data via loaders → published into Lane
      </h1>
      <p className="text-muted-foreground">
        A self-contained SPA that runs inside this Next.js route as a{" "}
        <strong>hash-routed client island</strong> (React Router owns{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">#/…</code>, Next owns
        the pathname — no router conflict). Each list route is loaded by a React
        Router <code className="rounded bg-muted px-1.5 py-0.5 text-sm">loader</code> and
        published into Lane with{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">LaneHydration</code>; the
        UI reads it back through{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">useLane</code>. Nothing
        about that mechanism is server-specific — the publisher here is a client
        router, and Lane cannot tell the difference.
      </p>
      <div className="rounded-lg border-l-2 border-foreground/40 bg-card px-4 py-3 text-sm">
        <strong>What to watch.</strong> Navigate Users / Posts and use the browser
        back / forward buttons. The previous page is held while the loader runs — no
        Suspense fallback flash even on back/forward — and the “navigating…” badge
        lights for every navigation, popstate included.
      </div>
      <p className="text-sm text-muted-foreground">
        <strong>Who owns the data.</strong> The loaders do. These reads are declared{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">loader: external</code>{" "}
        — they wait for a publication instead of fetching — and Lane refuses a client
        write to any key that arrived that way. So both buttons go through the owner:{" "}
        <em>Refresh</em> asks the router to re-run its loader (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">useRevalidator</code>),
        and <em>Edit</em> changes the source first and then asks for the same thing.
        The edit survives navigating away and back, because it was never a local
        edit — which is the part a cached-value patch could not promise here: the
        next loader run would have published the source's unchanged copy over the
        top of it, silently.
      </p>
    </section>
  );
}

function Toolbar({
  title,
  pending,
  onRefresh,
  onEdit,
}: {
  title: string;
  pending: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const btn =
    "rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-foreground/30 disabled:opacity-50";
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex gap-2">
        <button className={btn} onClick={onRefresh} disabled={pending}>
          {pending ? "Revalidating…" : "↻ Refresh (revalidate)"}
        </button>
        <button className={btn} onClick={onEdit} disabled={pending}>
          ✎ Edit (mutate + revalidate)
        </button>
      </div>
    </div>
  );
}

function UsersList() {
  const { revalidate, state } = useRevalidator();
  const { promise } = useLane(routeReads.users());
  const { data } = use(promise);
  const pending = state !== "idle";

  // Mutate the source, then ask its owner to publish again. The second line is
  // what puts it on screen — there is no third line writing to the store.
  const edit = () => {
    promoteFirstUser();
    void revalidate();
  };

  return (
    <section className="space-y-3">
      <Toolbar
        title="Users"
        pending={pending}
        onRefresh={() => void revalidate()}
        onEdit={edit}
      />
      <p className="text-sm tabular-nums text-muted-foreground">
        loaded {data.loadedAt} · fetch #{data.fetch} · {data.users.length} users
      </p>
      <ul className={`space-y-2 ${pending ? "opacity-50" : ""}`}>
        {data.users.map((u) => (
          <li key={u.id} className="rounded-lg border bg-card px-4 py-3">
            <Link
              to={`/users/${u.id}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {u.name}
            </Link>
            <span className="text-sm text-muted-foreground"> — {u.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UserDetail() {
  const { id } = useParams();
  const { promise } = useLane(routeReads.user(id!));
  const { data } = use(promise);

  return (
    <section className="space-y-3">
      <Link
        to="/users"
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        ← Users
      </Link>
      <div className="rounded-xl border bg-card px-5 py-4">
        <h2 className="text-lg font-semibold">{data.user.name}</h2>
        <p className="text-sm tabular-nums text-muted-foreground">
          loaded {data.loadedAt} · fetch #{data.fetch}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.user.role} · {data.user.email}
        </p>
        <h3 className="mt-4 mb-2 font-medium">Posts</h3>
        {data.posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts by this user.</p>
        ) : (
          <ul className="space-y-2">
            {data.posts.map((p) => (
              <li key={p.id} className="rounded-lg border px-3 py-2">
                <strong className="text-sm">{p.title}</strong>
                <div className="text-sm text-muted-foreground">{p.excerpt}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PostsList() {
  const { revalidate, state } = useRevalidator();
  const { promise } = useLane(routeReads.posts());
  const { data } = use(promise);
  const pending = state !== "idle";

  const edit = () => {
    promoteFirstPost();
    void revalidate();
  };

  return (
    <section className="space-y-3">
      <Toolbar
        title="Posts"
        pending={pending}
        onRefresh={() => void revalidate()}
        onEdit={edit}
      />
      <p className="text-sm tabular-nums text-muted-foreground">
        loaded {data.loadedAt} · fetch #{data.fetch} · {data.posts.length} posts
      </p>
      <ul className={`space-y-2 ${pending ? "opacity-50" : ""}`}>
        {data.posts.map((p) => (
          <li key={p.id} className="rounded-lg border bg-card px-4 py-3">
            <strong className="text-sm">{p.title}</strong>
            <div className="text-sm text-muted-foreground">
              by {userName(p.authorId)} — {p.excerpt}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Route table for `createHashRouter`. `path: "/"` is the hash root (#/).
export const routes = [
  {
    path: "/",
    Component: AppShell,
    HydrateFallback: RouteSkeleton,
    children: [
      { index: true, Component: Home },
      { path: "users", loader: usersLoader, Component: withHydration(UsersList) },
      { path: "users/:id", loader: userLoader, Component: withHydration(UserDetail) },
      { path: "posts", loader: postsLoader, Component: withHydration(PostsList) },
    ],
  },
];
