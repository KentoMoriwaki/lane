"use client";

import { Suspense } from "react";
import { NavLink, Outlet, useNavigation } from "react-router";

/**
 * Data mode: the router owns navigation state, so the pending indicator comes
 * from `useNavigation()` and fires for `<Link>`, programmatic nav, AND browser
 * back/forward (over the hash) alike. The previous route stays mounted while the
 * next loader runs — no fallback flash.
 */
export function AppShell() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const target = navigation.location?.pathname;

  return (
    <div className="relative">
      <div
        className={`absolute inset-x-0 top-0 h-0.5 ${isNavigating ? "animate-pulse bg-foreground/50" : "bg-transparent"}`}
      />
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center gap-2 border-b pb-4">
          <span className="mr-2 text-sm font-semibold">
            use-lane × RR v8 · hash data-mode
          </span>
          <Nav to="/" label="Home" end />
          <Nav to="/users" label="Users" />
          <Nav to="/posts" label="Posts" />
          <span className="flex-1" />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${isNavigating ? "border-foreground/40 text-foreground" : "text-muted-foreground"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isNavigating ? "animate-pulse bg-foreground" : "bg-muted-foreground/40"}`}
            />
            {isNavigating ? `navigating${target ? ` → ${target}` : ""}…` : "idle"}
          </span>
        </header>
        <main className="transition-opacity duration-150" style={{ opacity: isNavigating ? 0.6 : 1 }}>
          <Suspense fallback={<RouteSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function Nav({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md border px-3 py-1.5 text-sm transition-colors ${isActive ? "border-foreground/40 bg-muted text-foreground" : "text-muted-foreground hover:border-foreground/30"}`
      }
    >
      {label}
    </NavLink>
  );
}

export function RouteSkeleton() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-amber-500">
        ⚠ Suspense fallback (data mode: only the initial deep-link load)
      </p>
      <div className="h-6 w-2/5 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

/** Shown until the client island mounts (createHashRouter is client-only). */
export function Boot() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <RouteSkeleton />
    </div>
  );
}
