# React Query vs Lane Data Ownership

This document records the intended comparison model between the React Query
baseline and the future Lane implementation.

The two implementations do not need to use the same data ownership model. They
need to deliver the same product experience.

## Shared Product Requirement

Both implementations must support durable workspace state:

- active team
- task filters
- search query
- selected task
- refresh/retry
- mutation feedback
- reload/deep-link restoration
- back/forward behavior where appropriate

The URL must represent durable view state. A user should be able to reload or
share a URL and return to the same meaningful workspace context.

Ephemeral UI state should stay local:

- popover open/closed state
- dropdown open/closed state
- draft form inputs
- hover/focus state
- optimistic-only pending state

## React Query Baseline

The React Query app is a server-initialized client cache app.

Initial load:

```txt
URL
-> Server Component reads params/searchParams
-> Server Component resolves current user, active team, and initial filters
-> Server Component prefetches initial React Query cache
-> dehydrate
-> Client Workspace reads hydrated data through useQuery
```

After hydration, React Query owns live workspace data:

```txt
filter/search/task selection changes
-> URL state updates
-> Client Component reads URL state
-> useQuery receives the derived query key
-> React Query serves cache or fetches from the API
```

The baseline should avoid making every workspace-level search parameter change
into a Server Component data reload. Filter/search changes are normal
interaction-time data operations, and React Query should own them.

Use native History API for same-workspace durable view state when the goal is to
sync URL state without asking the App Router to reload Server Components.

```txt
window.history.pushState / replaceState
-> useSearchParams updates
-> React Query key changes
-> client-side fetch if needed
```

Use App Router navigation for route identity changes:

- sign in / sign out routes if introduced
- active team route changes
- workspace changes
- hard navigation and external deep links

## Lane Target

The Lane app should lean into Server Components for route/page data.

Route/page data:

```txt
URL
-> Server Component reads params/searchParams
-> Server Component loads active team, task list, insights, projects, labels,
   members, and selected task when present
-> Server Component passes data into Client Components
```

Lane should not replace Server Components for data that naturally belongs to the
route or page. If a piece of data is part of the durable workspace URL, Server
Components can own it.

Lane should own client-only async islands:

- assignee picker search
- label picker search and creation refresh
- command palette suggestions
- client-only detail sections
- distant client consumers that need to observe the same promise refresh
- interaction-time async data that is not the route/page owner

Lane coordinates promise identity for those client-owned async islands while
React owns pending, errors, optimistic UI, and transitions.

## Intentional Asymmetry

The comparison is intentionally asymmetric:

```txt
React Query:
  RSC prefetch
  -> hydrated client query cache
  -> React Query owns reads/writes after hydration

Lane:
  Server Components own route/page data
  -> Lane owns client-only async coordination
  -> React primitives own transitions, pending, errors, and optimistic UI
```

This asymmetry is acceptable. The goal is not to prove both apps use the same
architecture. The goal is to prove Lane can replace the user-facing experience
of a React Query app while using a React-native ownership model.

## Practical Routing Direction

React Query baseline:

- URL state should be durable.
- Server Component prefetch should serve initial load, reload, and deep links.
- Same-workspace filter/search updates should not depend on Server Component
  reloads.
- React Query should remain the live client data owner after hydration.

Lane target:

- URL state should be durable.
- App Router navigation may reload Server Components for route/page data.
- Server Components should own filtered task lists, insights, selected task
  detail, and other URL-owned workspace data.
- Lane should be reserved for client-only data that becomes relevant through
  interaction.

## Success Criteria

Both apps should satisfy the same user-facing outcomes:

- Reload preserves the active team, filters, search, and selected task.
- Back/forward behavior is predictable.
- Team switching does not leak previous team data.
- Lists and details converge after mutations.
- Pending and retry states are scoped rather than full-page failures.
- Client-only pickers and async controls remain responsive.
- The final experience feels like one coherent product, even though the data
  ownership models differ.
