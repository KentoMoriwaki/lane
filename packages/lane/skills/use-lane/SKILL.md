---
name: use-lane
description: Use when writing or reviewing React 19 async-data code that uses use-lane — reading data with useLane + use(), Suspense / Error-Boundary wiring, re-reading after a mutation (invalidate / set / update), refetch / polling / focus / reconnect revalidation, conditional or deferred reads, RSC or loader seeding (LaneHydration), router / Next.js integration, prefetching, or migrating React Query / SWR code. Lane owns promise identity; React owns loading, errors, transitions, and optimistic UI — prefer source invalidation over external-store cache patterns. Also use it to avoid common anti-patterns: reading a promise in useEffect/.then + setState instead of use(), hand-rolled isLoading, or patching the cache after a mutation.
---

# use-lane

**Promise-first. Transition-native.** `use-lane` keeps each keyed read's
**promise** in React state and replaces it inside React transitions. It does
**not** own a resolved-value cache or status flags — React owns loading
(Suspense), errors (Error Boundaries), pending (`useTransition` /
`isTransitionPending`), and optimistic UI (`useOptimistic`).

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
  `isLoading` / `error` / `status`. → `references/common-mistakes.md`, `references/design-notes.md`
- **Keep keys stable and serializable.** Lane dedupes by key, not by loader, so a
  key that changes every render refetches every render; the loader itself can be an
  inline closure (no `useCallback` needed). → `references/common-mistakes.md`
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

## Migrating React Query / SWR? Five traps

- **Map the model, don't port the shape.** `isLoading` → Suspense; `error` →
  `refreshError` only (an initial failure hits the Error Boundary, never a field);
  `refetchInterval` → a userland poll; `onMutate` → `useOptimistic`. Don't rebuild
  a status object on top of Lane. → `references/migrating.md`
- **Ephemeral UI needs its own boundary.** A modal / popover / combobox / tab panel
  that fires an initial read suspends to the nearest ancestor and *unmounts the
  surface* — put a `Suspense` inside it. → `references/common-mistakes.md`
- **Search / filter:** derive **both the key and the loader** from a
  `useDeferredValue` input so the list stays live. → `references/common-mistakes.md`
- **Polling off the render path:** don't put the key array in the effect deps;
  re-arm after each load or use a stable key id. → `references/api-reference.md#polling`
- **Forward `({ signal })` from each loader** — don't thread it through a module
  global. → `references/common-mistakes.md`

## Read next (progressive disclosure)

Load the reference that matches the task — don't read them all up front. For
exact signatures you can also read the package's bundled `dist/index.d.ts`.

| Task / question | Read |
| --- | --- |
| Avoiding common mistakes — reading promises in effects, manual loading state, hand-patched mutations | `references/common-mistakes.md` |
| Migrating React Query / SWR — the mental-model map, the transitional adapter, and the gotchas | `references/migrating.md` |
| Exact API: every export, option, return type, and behavior | `references/api-reference.md` |
| Why Lane is shaped this way; the reasoning behind each gotcha above | `references/design-notes.md` |
| Where Lane fits: RSC-first vs RSC-seeded ownership; who owns mutations | `references/architectures.md` |
| Wiring to Next.js / React Router / TanStack / plain SPA; the back-forward (`popstate`) flash caveat | `references/integrations.md` |
| Running outside the browser — CLI (Ink), React Native, other renderers; the `eventSource` prop | `references/environments.md` |
| Conditional / deferred reads | `references/api-reference.md#conditional-reads-gating`, `#deferred-reads-render-first-swap-when-ready` |
| `staleTime` / `whenStale`, polling, focus / reconnect, `gcTime` retention | `references/api-reference.md#laneuseoptions`, `#lifecycle-behavior` |
| Keys, and scoped (prefix / predicate) operations | `references/api-reference.md#keys` |
| Prefetch / warm the cache on intent (hover, focus) | `references/api-reference.md#prefetch` |
| RSC / loader seeding with `LaneHydration` | `references/api-reference.md#hydration-rsc-seeding` |
