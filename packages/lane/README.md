# use-lane

[![npm version](https://img.shields.io/npm/v/use-lane.svg)](https://www.npmjs.com/package/use-lane)
[![license](https://img.shields.io/npm/l/use-lane.svg)](https://github.com/KentoMoriwaki/lane/blob/main/packages/lane/LICENSE)

A promise-identity cache for React 19. Lane coordinates **which promise each key
currently renders**; React primitives own everything else — `use(promise)` for
data, Suspense for loading, Error Boundaries for initial errors, transitions for
convergence, and `useOptimistic` / `useActionState` for mutations.

```tsx
const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
const user = use(promise); // Suspense handles loading, Error Boundary handles failure
```

## Why Lane

Libraries like SWR and TanStack Query own a resolved-value cache plus their own
loading/error/status objects, optimistic patches, and mutation helpers. Lane
takes the opposite split: it owns only the **promise identity** behind each key
and lets React own the UI state it was designed to own in React 19.

- **One mental model.** Mutate the source, invalidate the read, render from the
  next promise — the same model you already use next to Server Components.
- **No parallel state machine.** No `data` / `error` / `isLoading` result object.
  You read with `use(promise)`; Suspense and Error Boundaries do the rest.
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

  const user = use(promise);
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

- **Keys are structural arrays** (`["task", id]`). They are matched exactly, or
  by `prefix` / predicate for scoped operations. `Date` segments are supported.
- **Invalidation-driven re-reads.** `invalidate` clears the cached promise and
  notifies mounted readers, which create the next promise from their current
  loader. Explicit (`transition`) and automatic (`focus` / `mount` / polling,
  reported as `isBackgroundPending`) re-reads are kept separate.
- **Stale-on-error.** A failed *refresh* keeps serving the last fulfilled value
  and reports the failure through `refreshError`. Only an *initial* load (no
  previous value) rejects the promise and reaches the Error Boundary.
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
| `useLane(key, loader, options?)` | Read a key. Returns `{ promise, refreshError, isTransitionPending, isBackgroundPending, invalidate }`. |
| `useLanePromise(key, loader, options?)` | Thin wrapper returning just `promise`. |
| `useLaneInstance()` | The current Lane instance, for `invalidate` / `set` / `update` / `remove` from event handlers. |
| `createLane()` | Create a Lane instance manually (e.g. to share one across providers or seed on the server). |
| `LaneHydration` | Apply RSC-loaded snapshots as authoritative seed values. |

`Lane` instance methods: `invalidate` / `invalidateAll`, `set`, `update` /
`updateAll`, `remove` / `removeAll`. `useLane` options: `staleTime`, `gcTime`,
`retry`, `retryDelay`, `refetchInterval`, `refetchOnFocus`, `refetchOnMount`,
`refetchOnReconnect`.

See the **[API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md)**
for full signatures and semantics.

## Documentation

- [API reference](https://github.com/KentoMoriwaki/lane/blob/main/docs/api-reference.md) — every export, option, and behavior.
- [Supported architectures](https://github.com/KentoMoriwaki/lane/blob/main/docs/architectures.md) — RSC-first and RSC-seeded client ownership.
- [Design notes](https://github.com/KentoMoriwaki/lane/blob/main/docs/design-notes.md) — why Lane is shaped this way.

## License

[MIT](./LICENSE) © Kento Moriwaki
