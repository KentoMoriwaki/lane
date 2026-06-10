# Lane Library Requirements From The React Query Baseline

This document derives library-layer requirements for Lane from how the current
`apps/todo-nextjs-react-query` implementation uses TanStack Query.

It intentionally does not define separate application requirements for
`apps/todo-nextjs-lane`. The Lane app has the same product and UX requirements
as the React Query baseline. Those requirements are defined by
`docs/team-task-app-requirements.md` and represented by the React Query
implementation.

The goal here is narrower: identify the library capabilities Lane needs so the
same app requirements can be implemented without TanStack Query.

## Layer Boundary

Lane library responsibilities:

- own promise identity for keyed async reads
- let React render from those promises
- notify exact-key subscribers when entries are invalidated, set, or removed
- support initial seeding for RSC-seeded client ownership
- support invalidating promise entries when source data changes
- support publishing already available authoritative data
- support exact and scoped entry removal

Application responsibilities:

- satisfy the same product and UX requirements as the React Query baseline
- choose keys and loaders
- place Suspense and Error Boundaries
- own URL state
- own mutation calls and mutation pending state
- own local optimistic reducers and failure recovery policy
- decide which data sources to invalidate or publish after each mutation
- show toasts, form errors, and permission-aware messages

## Required Capabilities

### Structural Keys

Lane must support stable structural keys made from arrays and serializable plain
objects.

The React Query baseline uses keys such as:

- `["current-user"]`
- `["teams"]`
- `["tasks", filters]`
- `["task", taskId]`
- `["projects"]`
- `["labels"]`
- `["members"]`
- `["insights"]`

Filter objects must produce stable key identity even when property order
differs.

### Promise Entry Creation

Lane must return a stable promise for a key until the entry cache is explicitly
invalidated, set to an authoritative promise, or removed.

If no entry exists, Lane may call the provided loader, store the returned
promise, and return it. React components should be able to unwrap the returned
promise with `use`.

### Initial Seeding

Lane must support RSC-seeded client ownership: a Server Component can load
initial data, pass it to a Client Component, and the client can seed Lane
entries before live client reads begin.

Seeding must be idempotent. Repeated provider renders, Strict Mode behavior, or
nested mounts should not overwrite newer client-owned entries that were created
after the initial seed.

### Invalidation

The React Query baseline uses invalidation this way after most writes:

- task writes invalidate task-list variants
- task writes invalidate insights
- task writes may invalidate selected task detail
- task writes invalidate projects when task counts may change
- label creation invalidates labels
- project creation invalidates projects
- manual workspace refresh invalidates multiple workspace reads

The important task-list case is that the app can have more than one existing
entry for the same logical source. For example, during one session the user may
have visited:

- all tasks
- my tasks
- unassigned tasks
- tasks filtered by a status
- tasks filtered by a project or label
- a searched task list

Those entries are all variants of the task-list source. A single task mutation
can affect several variants at once:

- changing status can move a task into or out of status-filtered lists
- changing assignee can affect my-tasks and unassigned lists
- changing project or labels can affect project-filtered and label-filtered
  lists
- deleting a task should remove it from any list variant that currently has it

The library does not need to understand any of those product rules. It only
needs to let the application say "invalidate the existing entries in this source
scope" so the app does not have to enumerate every possible filter combination.
Only entries that actually exist need to be invalidated.

Lane must support invalidating an exact key. A mounted reader for that key should
be able to observe the invalidation, re-render, and produce the next promise
from its current loader.

Exact-key invalidation is for reads that have one concrete identity, such as a
selected task detail, a labels list, a members list, or a retry button attached
to one failed read.

For invalidation-style workflows, Lane must also provide a way for an
application layer to invalidate all existing entries that match a scope, such as a
prefix or predicate. The exact API can be decided separately, but the capability
is required because the baseline invalidates active task-list variants.

Invalidation should not require Lane to eagerly run a stored loader away from
render. The reader that owns `useLane(key, loader)` can supply the current loader
when it re-renders after invalidation. Inactive entries can remain marked invalid
and fetch the next promise when they are read again.

### Confirmed Value Publication As An Optimization

Lane must support replacing the current promise for an exact key with a new
promise or already available value.

This is not for optimistic state. In Lane, optimistic state should stay in
component-local React state, such as `useOptimistic`, and should not be written
into the promise cache. Because optimistic state is not in Lane, Lane does not
need a rollback or revert concept.

The concrete use case is publishing authoritative data the application already
has. For example:

- initial RSC-loaded data can be represented as an already fulfilled promise
  before client reads begin
- after creating a task, the server response may be the full created task, so
  selecting that task can render its detail from the confirmed response instead
  of issuing an immediate duplicate detail fetch
- after a mutation returns a server-confirmed entity, exact-key consumers can
  observe that confirmed entity while broader list/summary entries are
  invalidated

The application decides when publishing an already available value is correct
and what the next server-confirmed value is.

From a subscriber perspective, confirmed value publication can behave like
invalidation after the next authoritative promise has already been placed in the
entry. It should not require a separate global optimistic cache path.

### Removal And Clearing

Lane must support removing exact entries and clearing broader scopes of
entries.

Removal is different from invalidation.

Invalidation means "this source changed; the next read should create a fresh
promise." The entry remains part of the store and may still be read again.

Removal means "this entry no longer belongs in the current client state." The
entry should be dropped instead of marked stale.

Concrete cases:

- sign out should clear user-scoped and team-scoped entries so signed-out UI
  cannot keep rendering previous session data
- team switch should remove previous team's task, label, project, member, and
  insight entries when keys are active-workspace-scoped
- deleting a selected task can remove that exact task detail entry instead of
  invalidating it for another fetch that would likely return not found

The library does not need to understand users, teams, or tasks. It only needs
the ability to remove entries selected by exact key, prefix, predicate, or
whole-store clear.

### Subscriptions

Lane must support exact-key subscriptions. Subscribers for a key need to be
notified when that key is invalidated, removed, or set to an authoritative
promise.

For invalidation, the notification lets mounted readers re-render and create the
next promise from their current loader. For authoritative `set`, subscribers can
take the same invalidation path after the next promise has already been stored.
For removal, subscribers need to stop using the removed promise. This
lets distant client consumers converge without sharing a global resolved-value
store.

### Transition Compatibility

Lane updates must compose with React transitions. When an application
invalidates data or changes keys inside a transition, React should be able to
keep the previous UI visible while the next promise is pending.

Removal is the exception. Removing data means the entry no longer belongs in the
current client state, so mounted readers should not preserve the old promise via
a transition.

Lane does not need a `keepPreviousData` option if its promise identity updates
work correctly with Suspense boundaries and transitions.

## Outside The Initial Baseline Scope

Lane library core does not need to provide the following capabilities to replace
the current React Query todo baseline:

- `useQuery`-style result objects
- `data` / `error` / `isLoading` hook fields
- `useMutation`
- mutation pending state
- optimistic reducers
- rollback policy
- HTTP client behavior
- URL state behavior
- task/team/session semantics
- toast or form error behavior
- global devtools
- synchronous resolved-value reads

Some of these may be implemented later, but they are not required to replace
the current React Query baseline.

The following React Query lifecycle capabilities are also outside this initial
baseline scope, but that should not be read as a permanent Lane non-goal:

- freshness tracking such as `staleTime`, `dataUpdatedAt`, or `isStale`
- mount-triggered reload, such as `refetchOnMount`
- focus-triggered reload, such as `refetchOnWindowFocus`
- reconnect-triggered reload, such as `refetchOnReconnect`
- polling, such as `refetchInterval`
- garbage collection for inactive entries, such as `gcTime`
- generalized retry policy, such as `retry`, `retryDelay`, and `retryOnMount`

If Lane adds these later, they should be designed as query lifecycle behavior on
top of keyed promise entries rather than as mutation state, optimistic state, or
`useQuery`-style result objects.

See `docs/lane-query-lifecycle-requirements.md` for the user-facing
requirements and core boundary for these lifecycle capabilities.
