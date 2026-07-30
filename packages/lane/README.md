# use-lane

[![npm version](https://img.shields.io/npm/v/use-lane.svg)](https://www.npmjs.com/package/use-lane)
[![license](https://img.shields.io/npm/l/use-lane.svg)](https://github.com/KentoMoriwaki/lane/blob/main/packages/lane/LICENSE)

**Promise-first. Transition-native.**

Lane is a minimal data layer for React 19. It keeps each keyed read's promise in
React state, so Suspense reads it, transitions replace it, and the screen you're
looking at stays live while the next data loads. No spinner flash, no torn UI,
no parallel query state machine.

React 19 ships the primitives to *render* async data — `use(promise)` for data,
Suspense for loading, Error Boundaries for errors, transitions for non-blocking
updates, and `useOptimistic` / `useActionState` for mutations. It doesn't ship
the small coordination layer underneath: stable promise identity by key, one
shared request across components, and a way to replace that promise after the
source changes. Lane is exactly that layer — and nothing React already provides.

```tsx
const { promise } = useLane({
  key: ["user", id],
  loader: ({ signal }) => fetchUser(id, signal),
});
const { data: user } = use(promise); // Suspense owns loading, Error Boundaries own errors
```

## Why Lane

Libraries like SWR and TanStack Query own a resolved-value cache plus their own
loading/error/status objects, optimistic patches, and mutation helpers. Lane
takes the opposite split: the **promise is the state**. Lane owns only the
promise identity and lifecycle behind each key; React owns the UI state it was
designed to own.

- **Promise-first by construction.** Lane keeps each key's current promise in
  React state instead of reading resolved query state from an external store.
  `use(promise)` is the only read path: Suspense owns the first load, an Error
  Boundary owns the first failure, and a refresh swaps in the next promise.
- **Promise replacement is transition-native.** Invalidation and revalidation
  replace the promise through a transition. Key changes compose with
  `startTransition` or `useDeferredValue`, so the same interruptible transition
  model drives the rest of your app and keeps the current screen live.
- **One mental model.** Mutate the source, invalidate the read, render from the
  next promise — the same model you already use next to Server Components.
- **No parallel state machine.** No `isLoading` / `isError` / `status` fields.
  `use(promise)` gives you `{ data }` (and a `refreshError` only when a refresh
  fails over existing data); Suspense and Error Boundaries do the rest.
- **No mutation helper, by design.** Mutations stay in React primitives, so
  optimistic UI lives next to the action that triggered it instead of in a
  global cache that needs rollback semantics.
- **Minimal on purpose.** A typical `LaneProvider` + `useLane` import is about
  **3.1 kB** minified and Brotli-compressed. Lane stays small because it does not
  reimplement the UI state machine React already ships.

## Requirements

React **19.2+** (Lane uses `useEffectEvent`). React is a peer dependency.

Lane leans on React core (`use`, Suspense, `useTransition`, `useEffectEvent`),
never `react-dom`, so it runs in **any React renderer** — the browser, **React
Native**, an **Ink** CLI, or your own. See
[Environments](https://github.com/KentoMoriwaki/lane/blob/main/docs/environments.md)
for CLI / React Native setup.

## Install

```sh
npm install use-lane
# or: pnpm add use-lane
# or: yarn add use-lane
```

## Quick start

**1. Wrap your client tree in a `LaneProvider`.**

```tsx
"use client";

import { LaneProvider } from "use-lane";

export function Providers({ children }: { children: React.ReactNode }) {
  return <LaneProvider>{children}</LaneProvider>;
}
```

**2. Read with `useLane` and unwrap with `use`.** Lane returns the promise; a
`Suspense` boundary owns the loading state and an Error Boundary owns the
initial-load failure.

```tsx
"use client";

import { Suspense, use } from "react";
import { useLane } from "use-lane";

function Profile({ userId }: { userId: string }) {
  const { promise } = useLane({
    key: ["user", userId],
    loader: async ({ signal }) => {
      const res = await fetch(`/api/users/${userId}`, { signal });
      if (!res.ok) throw new Error("Failed to load user");
      return (await res.json()) as User;
    },
  });

  const { data: user } = use(promise);
  return <h1>{user.name}</h1>;
}

export function UserProfile({ userId }: { userId: string }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Profile userId={userId} />
    </Suspense>
  );
}
```

**3. Converge after a mutation by invalidating the source.** Mounted readers
re-read through a transition; `isTransitionPending` tells you it is happening.

```tsx
"use client";

import { useLaneInstance } from "use-lane";

function RenameButton({ userId }: { userId: string }) {
  const lane = useLaneInstance();

  async function rename(name: string) {
    await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    // Source changed → re-read the affected key. React renders the next promise.
    lane.invalidate(["user", userId]);
  }

  return <button onClick={() => rename("Ada")}>Rename</button>;
}
```

## Core concepts

- **Transition-native re-reads.** Updates run through `useTransition`, so the
  previous UI stays mounted and interactive while the next promise resolves —
  `isTransitionPending` and `isBackgroundPending` tell you which is in flight.
  Pair a key with `useDeferredValue` for search and filter UIs. (Initial loads
  with no prior data still suspend to a Suspense fallback.)
- **Keys are structural arrays** (`["task", id]`). They are matched exactly, or
  by `prefix` / predicate for scoped operations. `Date` segments are supported.
- **Invalidation-driven re-reads.** `invalidate` clears the cached promise and
  notifies mounted readers, which create the next promise from their current
  loader. Explicit (`transition`) and automatic (`focus` / `mount` / polling,
  reported as `isBackgroundPending`) re-reads are kept separate.
- **Stale-on-error.** A failed *refresh* keeps serving the last fulfilled value;
  the promise resolves to `{ data, refreshError }`, so `use(promise)` surfaces the
  stale data and the error together. Only an *initial* load (no previous value)
  rejects the promise and reaches the Error Boundary.
- **Authoritative publication.** `set` / `update` publish server-confirmed data
  to exact keys; `LaneHydration` seeds promises from RSC-loaded data and
  overwrites authoritatively on navigation.
- **Lifecycle built in.** Garbage collection (`gcTime`, default 5 min), `retry` /
  `retryDelay`, and `refetchOnFocus` / `refetchOnMount` / `refetchOnReconnect`
  revalidation. Every read option has an app-wide fallback —
  `createLane({ defaults })`, react-query's `defaultOptions.queries`. Polling is
  userland — a self-scheduled `invalidate`.
- **Optimistic UI stays local.** Lane ships no mutation helper; use
  `useOptimistic` / `useActionState` in the component that owns the action.
- **A read can be one value.** `laneRead({ key, loader, ...options })` colocates
  a read the way react-query's `queryOptions()` does. The loaded type rides on the
  **key** it hands back (like react-query's `DataTag`), so `set` / `update` are
  type-checked from the key alone and a mutation path never imports a fetcher.

## API at a glance

| Export | Purpose |
| --- | --- |
| `LaneProvider` | Provides a Lane instance to the tree; wires focus / reconnect revalidation via a pluggable `eventSource` (browser default; React Native / CLI / custom). |
| `useLane(key, loader, options?)` | Read a key. Returns `{ promise, isTransitionPending, isBackgroundPending, invalidate }`; `use(promise)` yields `{ data, refreshError }`. |
| `useLanePromise(key, loader, options?)` | Thin wrapper returning just `promise`. |
| `laneRead({ key, loader, …options })` | Colocate a read's key, loader, and options in one value — react-query's `queryOptions()` for Lane. Reads take the whole thing (`useLane`, `useLanesAll`, `prefetch`); entry operations take its `key`. |
| `laneKey<T>(key)` | A key that carries what its entry holds, so `set` / `update` through it are type-checked — no loader needed. |
| `useInfiniteLane(key, options, readOptions?)` | A cursor-paginated list under one key. Returns `{ promise, loadMore, … }`; `use(promise)` yields `{ pages, params, hasNext }`. Colocate it with `infiniteLaneRead`. |
| `useLaneInstance()` | The current Lane instance, for `invalidate` / `set` / `update` / `remove` from event handlers. |
| `createLane(options?)` | Create a Lane instance manually (e.g. to share one across providers, seed on the server, or set app-wide read defaults); accepts `{ gcTime, defaults }`. |
| `LaneHydration` | Apply RSC-loaded snapshots as authoritative seed values. |

`Lane` instance methods: `invalidate` / `invalidateAll`, `set`, `update` /
`updateAll`, `remove` / `removeAll` — all keyed; `set` / `update` are checked
when given a typed key. `useLane` options: `staleTime`, `whenStale`,
`retry`, `retryDelay`, `refetchOnFocus`, `refetchOnMount`, `refetchOnReconnect`.
`createLane` options: `gcTime`, and `defaults` — the same read options, applied to
every read that does not specify them. Loaders receive `{ key, signal, current }`, where
`current` is the entry's last fulfilled value.

See the **[API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md)**
for full signatures and semantics.

## Documentation

- [API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md) — every export, option, and behavior.
- [Migrating from React Query / SWR](https://github.com/KentoMoriwaki/lane/blob/main/docs/migrating.md) — the mental-model map and the migration gotchas.
- [Supported architectures](https://github.com/KentoMoriwaki/lane/blob/main/docs/architectures.md) — RSC-first and RSC-seeded client ownership.
- [Environments](https://github.com/KentoMoriwaki/lane/blob/main/docs/environments.md) — CLI (Ink), React Native, and other React renderers.
- [Design notes](https://github.com/KentoMoriwaki/lane/blob/main/docs/design-notes.md) — why Lane is shaped this way.

## Agent skill

This package ships an [Agent Skills](https://agentskills.io/) skill, so AI coding
agents get use-lane-aware guidance that is **version-locked to the installed
package**. It lives at `skills/use-lane/SKILL.md` and is self-contained — the
full documentation is bundled alongside it as references.

If your project uses an AI agent, point it at the skill from your `AGENTS.md` /
`CLAUDE.md`:

```md
## Agent skills

Before editing React data-loading code, read the use-lane skill at
`node_modules/use-lane/skills/use-lane/SKILL.md` — use it for Suspense, `use()`,
transitions, invalidation, refetching, optimistic UI, or React Query / SWR
migration work.
```

## License

[MIT](./LICENSE) © Kento Moriwaki
