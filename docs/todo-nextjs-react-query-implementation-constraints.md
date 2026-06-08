# todo-nextjs-react-query Implementation Constraints

This document defines the implementation constraints for the
`todo-nextjs-react-query` baseline app.

The goal of this app is to represent a natural TanStack Query implementation of
the team task product requirements. It should become the behavioral and UX
baseline that Lane can later replace.

This document intentionally avoids detailed data modeling. The data model should
be derived during implementation from the product requirements in
`docs/team-task-app-requirements.md`.

For the intended comparison between the React Query baseline and the future
Lane implementation, see `docs/react-query-vs-lane-data-ownership.md`.

## Purpose

Build a React Query baseline for the richer team task management app.

The baseline should answer this question:

> If a team task app were built naturally with Next.js and TanStack Query, what
> UI/UX and async behavior should Lane be able to replace?

The app should not be a toy TODO example. It should use the saved visual
direction named "Calm Command Workspace": a calm, premium team workspace with a
clear command-center structure, top insight strip, central task list, and right
detail panel.

## App Package

Create a new app package:

```txt
apps/todo-nextjs-react-query
```

The app should sit next to the existing demo apps:

```txt
apps/todo-nextjs-swr
apps/todo-nextjs-lane
apps/todo-nextjs-react-query
```

## Primary Stack

- Next.js App Router
- React 19
- TypeScript
- TanStack Query v5
- Tailwind CSS
- shadcn/ui
- lucide-react

Useful supporting libraries can be added when they clearly support the UI:

- `@tanstack/react-query-devtools`
- `class-variance-authority`
- `tailwind-merge`
- `cmdk`
- `sonner`
- Radix primitives through shadcn/ui components

Avoid adding broad UI frameworks beyond Tailwind and shadcn/ui.

## API Boundary

Use the existing API package:

```txt
apps/todo-api
```

Existing API compatibility is not required. The API can be redesigned from
scratch to support the team task app requirements.

The important constraint is that the API boundary should be real:

- The frontend should call HTTP JSON endpoints.
- React Query should fetch and mutate through API client functions.
- The same API should later be usable by the Lane implementation.
- Mock authentication and lightweight authorization are acceptable.

Do not use in-memory frontend-only data as the primary source of truth for the
baseline.

## Type-Safe API Client

Use Hono RPC through `hono/client` for type-safe frontend API access.

The API package should export the Hono route type:

```ts
export type AppType = typeof routes;
```

The React Query app should consume that type as a type-only dependency and
construct a typed client:

```ts
import type { AppType } from "@lane/todo-api";
import { hc } from "hono/client";

const client = hc<AppType>(apiUrl);
```

API client functions should wrap the typed Hono client and become the only
place where React Query hooks call the backend.

Keep these constraints:

- Prefer Hono RPC calls over hand-written `fetch` URL strings.
- Export shared API response/input types from `@lane/todo-api` when useful.
- Keep frontend imports from `@lane/todo-api` type-only unless runtime sharing is
  intentionally needed.
- Keep request/response validation in the API package.
- Preserve the HTTP boundary even though the client is typed.

## Server Components And Hydration

Use Server Components for initial data collection only.

The intended structure is:

```txt
Server Component page
  -> create QueryClient
  -> prefetch initial queries
  -> dehydrate query state
  -> render HydrationBoundary
      -> Client Workspace
          -> useQuery reads hydrated data
          -> useMutation owns writes
```

This makes the React Query app a server-initialized client cache app.

The Server Component layer should not remain the owner of the displayed data.
After hydration, the Client Component tree and React Query cache own reads,
writes, refresh, optimistic updates, and retries.

## Initial Data

Prefetch the data needed for a meaningful first workspace render.

Likely initial queries include:

- current user
- available teams
- current team
- current team's task list
- current team's insight summary
- current team's projects
- current team's labels
- current team's members

The exact query set can change during implementation, but it should support the
first screen without a full-page client loading state.

## Client Data Ownership

After hydration, data should be read through TanStack Query hooks.

Use TanStack Query for:

- task list reads
- selected task detail reads
- insight summary reads
- team members
- projects
- labels
- assignee suggestions
- label/project selectors
- mutations
- invalidation
- optimistic updates
- retry
- scoped error states

Do not render the same live application data directly from Server Component
props while also rendering it from React Query. That would create ambiguous data
ownership and make the Lane comparison less useful.

## Mutations

Use client-side mutations through TanStack Query.

Use `useMutation` for operations such as:

- create task
- update task fields
- change task status
- assign or unassign a task
- add or remove labels
- create label
- switch team context when represented as client state
- update lightweight user/team preferences

Use React Query tools naturally:

- `invalidateQueries`
- `setQueryData`
- optimistic updates
- rollback on error where useful
- scoped mutation pending states

The baseline should show how a normal React Query app would solve the product
requirements. It does not need to mimic Lane.

## Next.js Features To Avoid In This Baseline

Avoid using Next.js features that would make React Query less clearly
responsible for the client data layer.

Do not use:

- Server Actions for app mutations
- `revalidatePath`
- `revalidateTag`
- `router.refresh()` as the normal refresh mechanism
- Next.js fetch cache as the source of application consistency
- RSC-owned live task rendering after hydration

These features may be appropriate in the later Lane implementation, but they
should not drive the React Query baseline.

## Team Scope And Query Key Constraints

The app should treat one team as the active workspace at a time.

The current requirements do not include viewing or editing multiple teams at the
same time. Because of that, team-owned query keys do not need to include
`teamId` by default.

Prefer active-team-scoped query keys:

```ts
["tasks", filters]
["task", taskId]
["labels"]
["members"]
["projects"]
["insights"]
```

Keep user/session-level keys separate:

```ts
["current-user"]
["teams"]
```

When the active team changes:

- clear or remove team-scoped queries from the React Query cache
- fetch the new team's workspace data
- avoid showing stale data from the previous team as if it belonged to the new
  team

The selected team should still be sent to the API through request context,
headers, session state, or explicit request parameters. It just does not need to
be encoded into every frontend query key for this baseline.

If a future requirement needs multiple teams visible at the same time, revisit
this constraint and add team scope to query keys then.

## UI Stack Constraints

Use Tailwind CSS and shadcn/ui as the base UI system.

shadcn/ui components should be copied into the app and treated as local source
that can be adapted to the visual direction.

Likely shadcn/ui components:

- Button
- Input
- Badge
- Avatar
- Separator
- Tabs
- Dropdown Menu
- Popover
- Command
- Select
- Sheet
- Dialog
- Textarea
- Skeleton
- Tooltip
- Sonner

Do not treat shadcn/ui defaults as the finished design. Compose them into the
saved Calm Command Workspace direction.

## Visual Direction

Use the saved Product Design reference:

```txt
/Users/moriwakikento/.codex/state/plugins/product-design/assets/lane-calm-command-workspace-direction.png
```

The desired product direction:

- calm, premium, app-like workspace
- white and light mist surfaces
- ink text
- sage green, cobalt, rose, and amber accents
- restrained borders and shadows
- subtle row separators
- 6-8px radius
- left navigation
- top search/create/sync controls
- top insight strip
- central task list
- right task detail panel

Avoid:

- toy TODO styling
- marketing hero layouts
- card-heavy dashboard kits
- every row as a standalone card
- dark navy dominance
- purple-heavy gradients
- beige-heavy palettes
- decorative blobs

## UX Constraints

The app should avoid full-page loading and full-page failure states whenever a
more scoped state is possible.

Prefer:

- hydrated first render
- keeping useful previous data visible during refresh
- scoped skeletons
- scoped retry controls
- mutation pending states near the action
- optimistic updates for quick interactions
- visible convergence after server confirmation

The app should make these states observable enough that Lane can later prove it
can match or improve them with React transitions.

## Comparison Target For Lane

The React Query app is successful if it creates a credible baseline that Lane
can replace.

The later Lane implementation should be able to match the same user-facing
experience while using one of Lane's supported ownership models. For the full
architecture positioning, see `docs/lane-supported-architectures.md`.

```txt
React Query baseline:
  Server Component prefetch
  -> hydrated client query cache
  -> React Query owns reads and writes after hydration

Lane RSC-seeded client ownership target:
  Server Component initial load
  -> seeded client promise cache
  -> Lane owns reads and refreshes after hydration
  -> React primitives own pending, errors, transitions, and optimistic UI

Lane RSC-first target:
  Server Components own route/page data
  -> Lane owns client-only async islands and shared promise refresh
  -> React primitives own pending, errors, transitions, and optimistic UI
```

The RSC-seeded client ownership target is the closest direct replacement for the
React Query baseline. The RSC-first target remains useful for validating Lane as
an async island layer next to Server Component-owned route data.

The comparison should focus on user experience and implementation clarity, not
on copying API shapes.
