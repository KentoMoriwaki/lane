"use client";

import { type ComponentType, use } from "react";
import {
  Link,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams,
} from "react-router";
import {
  LaneHydration,
  type LaneHydrationSnapshots,
  type LaneUseOptions,
  useLane,
  useLaneInstance,
} from "use-lane";
import { fetchPosts, fetchUser, fetchUsers, userName } from "./api";
import { AppShell, RouteSkeleton } from "./shell";

const READ_POLICY: LaneUseOptions = { staleTime: 5_000, whenStale: "revalidate" };

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

// ---- seed Lane from the loader's snapshot, then render the UI ----------------
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
        Route data via loaders → hydrated into Lane
      </h1>
      <p className="text-muted-foreground">
        A self-contained SPA that runs inside this Next.js route as a{" "}
        <strong>hash-routed client island</strong> (React Router owns{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">#/…</code>, Next owns
        the pathname — no router conflict). Each list route is loaded by a React
        Router <code className="rounded bg-muted px-1.5 py-0.5 text-sm">loader</code> and
        seeded into Lane with{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">LaneHydration</code>; the
        UI reads it back through{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">useLane</code>.
      </p>
      <div className="rounded-lg border-l-2 border-foreground/40 bg-card px-4 py-3 text-sm">
        <strong>What to watch.</strong> Navigate Users / Posts and use the browser
        back / forward buttons. The previous page is held while the loader runs — no
        Suspense fallback flash even on back/forward — and the “navigating…” badge
        lights for every navigation, popstate included.
      </div>
      <p className="text-sm text-muted-foreground">
        After hydration <strong>Lane owns the data</strong>:{" "}
        <em>Refresh</em> re-reads through Lane (no navigation), and{" "}
        <em>Edit (lane.update)</em> rewrites the cached value <em>in place with no
        fetch</em> — something React Router's loader model can't do. Navigating away and
        back re-runs the loader and re-seeds authoritative data, overwriting the edit.
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
          {pending ? "Refreshing…" : "↻ Refresh (invalidate)"}
        </button>
        <button className={btn} onClick={onEdit} disabled={pending}>
          ✎ Edit (lane.update)
        </button>
      </div>
    </div>
  );
}

function UsersList() {
  const lane = useLaneInstance();
  const { promise, isTransitionPending, invalidate } = useLane(
    ["users"],
    ({ signal }) => fetchUsers(signal),
    READ_POLICY,
  );
  const { data } = use(promise);

  // lane.update: rewrite the cached value in place — no loader, no fetch.
  const editInPlace = () => {
    lane.update<typeof data>(["users"], (current) => ({
      ...current,
      loadedAt: `${new Date().toLocaleTimeString()} (client edit)`,
      users: current.users.map((u, i) =>
        i === 0 ? { ...u, name: `★ ${u.name}` } : u,
      ),
    }));
  };

  return (
    <section className="space-y-3">
      <Toolbar
        title="Users"
        pending={isTransitionPending}
        onRefresh={invalidate}
        onEdit={editInPlace}
      />
      <p className="text-sm tabular-nums text-muted-foreground">
        loaded {data.loadedAt} · fetch #{data.fetch} · {data.users.length} users
      </p>
      <ul className={`space-y-2 ${isTransitionPending ? "opacity-50" : ""}`}>
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
  const { promise } = useLane(
    ["user", id],
    ({ signal }) => fetchUser(id!, signal),
    READ_POLICY,
  );
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
  const lane = useLaneInstance();
  const { promise, isTransitionPending, invalidate } = useLane(
    ["posts"],
    ({ signal }) => fetchPosts(signal),
    READ_POLICY,
  );
  const { data } = use(promise);

  const editInPlace = () => {
    lane.update<typeof data>(["posts"], (current) => ({
      ...current,
      loadedAt: `${new Date().toLocaleTimeString()} (client edit)`,
      posts: current.posts.map((p, i) =>
        i === 0 ? { ...p, title: `★ ${p.title}` } : p,
      ),
    }));
  };

  return (
    <section className="space-y-3">
      <Toolbar
        title="Posts"
        pending={isTransitionPending}
        onRefresh={invalidate}
        onEdit={editInPlace}
      />
      <p className="text-sm tabular-nums text-muted-foreground">
        loaded {data.loadedAt} · fetch #{data.fetch} · {data.posts.length} posts
      </p>
      <ul className={`space-y-2 ${isTransitionPending ? "opacity-50" : ""}`}>
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
