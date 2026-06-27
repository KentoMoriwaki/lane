---
name: use-lane
description: Use when writing or reviewing React 19 async-data code that uses use-lane — reading data with useLane + use(), Suspense / Error-Boundary wiring, re-reading after a mutation (invalidate / set / update), refetch / polling / focus / reconnect revalidation, conditional or deferred reads, RSC or loader seeding (LaneHydration), router / Next.js integration, prefetching, or migrating React Query / SWR code. Lane owns promise identity; React owns loading, errors, transitions, and optimistic UI — prefer source invalidation over external-store cache patterns.
---

# use-lane

Transition-native data fetching for React 19. `use-lane` caches the **promise**
behind each key and re-reads it inside React transitions. It does **not** own a
resolved-value cache or status flags — React owns loading (Suspense), errors
(Error Boundaries), pending (`useTransition` / `isTransitionPending`), and
optimistic UI (`useOptimistic`).

**The one rule that explains every API: Lane owns _promise identity_; React owns
_UI state_.** When something looks missing — no `isLoading`, no `useMutation`, no
cache-patching API — it is missing on purpose. Reach for the React primitive
instead of recreating a React Query / SWR cache on top of Lane.

## When to use

- A client component reads async data and must re-read it after a mutation, on
  focus / reconnect, on an interval, or when a key (filter / search / id) changes.
- You want refetches to stay non-blocking — the current screen stays live — via
  transitions, not a library `keepPreviousData` flag.
- You seed client reads from RSC / router-loader data, then own them on the client.
- You are migrating React Query / SWR code to the React-19-native split.

**Not for:** data that should stay server-owned (let Server Components / Actions
own it), or as a global store for mutation / optimistic state (that stays local
to the action via `useOptimistic` / `useActionState`).

## Minimal shape

```tsx
// Read: Lane returns the promise; use() unwraps it; Suspense + Error Boundary do the UI.
const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
const { data } = use(promise); // { data, refreshError } — no isLoading / error / status

// Converge after a mutation: change the source, invalidate the key, re-read.
const lane = useLaneInstance();
await patchUser(id, body);
lane.invalidate(["user", id]); // mounted readers re-read inside a transition
```

## Core rules (skim before writing code)

Each rule points to the reference that explains it. Read the reference when the
task touches that rule.

- **Read with `use(promise)`** — never store `data` in your own state or an
  external store. `use()` yields `{ data, refreshError }`; there is no
  `isLoading` / `error` / `status`. → `references/design-notes.md`
- **Keep the loader's promise identity stable per key.** Lane dedupes by key, not
  by loader; don't restructure code so a fresh promise is forced every render.
  → `references/api-reference.md`
- **Converge by invalidating the source**, not by patching a cache. Use `set` /
  `update` only to publish data you *already have* (e.g. a mutation response);
  use `remove` to drop entries on sign-out / team switch. → `references/api-reference.md`
- **Wrap key changes and navigation in a transition** (or drive the key from
  `useDeferredValue`) so the current screen stays live. Initial loads with no
  prior value still suspend to a Suspense fallback. → `references/integrations.md`
- **A failed _refresh_ keeps serving stale data** as `{ data, refreshError }`;
  only an _initial_ load rejects to the Error Boundary. Don't treat
  `refreshError` as fatal. → `references/design-notes.md`
- **No `useMutation`, no optimistic cache.** Optimistic state stays local via
  `useOptimistic` / `useActionState` next to the action. → `references/architectures.md`
- **Disable a read by passing `loader: undefined`** (gating). `promise` is then
  `undefined`; unwrap conditionally: `result.promise ? use(result.promise) : fallback`.
  → `references/api-reference.md#conditional-reads-gating`

## Read next (progressive disclosure)

Load the reference that matches the task — don't read all four up front. For
exact signatures you can also read the package's bundled `dist/index.d.ts`.

| Task / question | Read |
| --- | --- |
| Exact API: every export, option, return type, and behavior | `references/api-reference.md` |
| Why Lane is shaped this way; the reasoning behind each gotcha above | `references/design-notes.md` |
| Where Lane fits: RSC-first vs RSC-seeded ownership; who owns mutations | `references/architectures.md` |
| Wiring to Next.js / React Router / TanStack / plain SPA; the back-forward (`popstate`) flash caveat | `references/integrations.md` |
| Conditional / deferred reads | `references/api-reference.md#conditional-reads-gating`, `#deferred-reads-render-first-swap-when-ready` |
| `staleTime` / `whenStale`, polling, focus / reconnect, `gcTime` retention | `references/api-reference.md#laneuseoptions`, `#lifecycle-behavior` |
| Keys, and scoped (prefix / predicate) operations | `references/api-reference.md#keys` |
| Prefetch / warm the cache on intent (hover, focus) | `references/api-reference.md#prefetch` |
| RSC / loader seeding with `LaneHydration` | `references/api-reference.md#hydration-rsc-seeding` |
