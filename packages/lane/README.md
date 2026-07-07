# use-lane

[![npm version](https://img.shields.io/npm/v/use-lane.svg)](https://www.npmjs.com/package/use-lane)
[![license](https://img.shields.io/npm/l/use-lane.svg)](https://github.com/KentoMoriwaki/lane/blob/main/packages/lane/LICENSE)

**Transition-native data fetching for React 19.** Refetches run inside React
transitions — invalidate after a mutation, revalidate on focus, or defer a
filter change, and the screen you're looking at stays live while the next data
loads. No spinner flash, no torn UI.

React 19 ships the primitives to *render* async data — `use(promise)` for data,
Suspense for loading, Error Boundaries for errors, transitions for non-blocking
updates, and `useOptimistic` / `useActionState` for mutations. It doesn't ship
the layer underneath: something to cache those promises by key, share one request
across components, and re-fetch after a change. Lane is exactly that layer — and
nothing else.

```tsx
const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
const { data: user } = use(promise); // Suspense owns loading, Error Boundaries own errors
```

## Why Lane

Libraries like SWR and TanStack Query own a resolved-value cache plus their own
loading/error/status objects, optimistic patches, and mutation helpers. Lane
takes the opposite split: it owns only the **promise identity** behind each key
and lets React own the UI state it was designed to own in React 19.

- **Every update is a transition.** SWR and React Query keep the previous screen
  during a refetch with a library flag (`keepPreviousData` / `placeholderData`).
  Lane keeps each key's promise in React state, so wrapping a key change or an
  `invalidate` in `startTransition` — or `useDeferredValue` — *just works*: the
  same transition you use everywhere else, interruptible, with a real pending
  flag.
- **One mental model.** Mutate the source, invalidate the read, render from the
  next promise — the same model you already use next to Server Components.
- **No parallel state machine.** No `isLoading` / `isError` / `status` fields.
  `use(promise)` gives you `{ data }` (and a `refreshError` only when a refresh
  fails over existing data); Suspense and Error Boundaries do the rest.
- **No mutation helper, by design.** Mutations stay in React primitives, so
  optimistic UI lives next to the action that triggered it instead of in a
  global cache that needs rollback semantics.

## Requirements

React **19.2+** (Lane uses `useEffectEvent`). React is a peer dependency.

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
  const { promise } = useLane(["user", userId], async ({ signal }) => {
    const res = await fetch(`/api/users/${userId}`, { signal });
    if (!res.ok) throw new Error("Failed to load user");
    return (await res.json()) as User;
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
  `retryDelay`, `refetchInterval` polling, and `refetchOnFocus` /
  `refetchOnMount` / `refetchOnReconnect` revalidation.
- **Optimistic UI stays local.** Lane ships no mutation helper; use
  `useOptimistic` / `useActionState` in the component that owns the action.

## API at a glance

| Export | Purpose |
| --- | --- |
| `LaneProvider` | Provides a Lane instance to the tree; wires focus / reconnect revalidation. |
| `useLane(key, loader, options?)` | Read a key. Returns `{ promise, isTransitionPending, isBackgroundPending, invalidate }`; `use(promise)` yields `{ data, refreshError }`. |
| `useLanePromise(key, loader, options?)` | Thin wrapper returning just `promise`. |
| `useLaneInstance()` | The current Lane instance, for `invalidate` / `set` / `update` / `remove` from event handlers. |
| `createLane(options?)` | Create a Lane instance manually (e.g. to share one across providers or seed on the server); accepts `{ gcTime }`. |
| `LaneHydration` | Apply RSC-loaded snapshots as authoritative seed values. |

`Lane` instance methods: `invalidate` / `invalidateAll`, `set`, `update` /
`updateAll`, `remove` / `removeAll`. `useLane` options: `staleTime`, `whenStale`,
`retry`, `retryDelay`, `refetchInterval`, `refetchOnFocus`, `refetchOnMount`,
`refetchOnReconnect`. `createLane` options: `gcTime`.

See the **[API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md)**
for full signatures and semantics.

## Documentation

- [API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md) — every export, option, and behavior.
- [Migrating from React Query / SWR](https://github.com/KentoMoriwaki/lane/blob/main/docs/migrating.md) — the mental-model map and the migration gotchas.
- [Supported architectures](https://github.com/KentoMoriwaki/lane/blob/main/docs/architectures.md) — RSC-first and RSC-seeded client ownership.
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
