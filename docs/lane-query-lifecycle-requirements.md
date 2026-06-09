# Lane Query Lifecycle Requirements

This document records the user-facing requirements behind React Query-like
query lifecycle behavior in Lane.

The goal is not to make Lane a React Query clone internally. Public APIs may be
familiar where the concepts are not important to differentiate. The important
constraint is that Lane core should stay small and maintainable: core should
hold the lifecycle facts and atomic primitives needed by higher-level policies,
not a large bundle of browser event, retry, polling, and mutation behavior.

## Problem Statement

The current Lane core supports keyed promise identity, explicit invalidation,
authoritative value publication, scoped removal, and React subscriptions.

That is enough for mutation-driven convergence, manual refresh, RSC-seeded
initial data, and scoped retry buttons. It is not enough for query lifecycle
requirements where the application needs to know whether cached data is fresh,
active, inactive, or eligible for automatic reload.

The missing lifecycle layer should solve application problems, not just copy
React Query option names.

## User-Facing Requirements

### 1. Do Not Leave Old Data Visible After Returning To A Screen

When a user reopens a screen or remounts a component, the app should not keep
showing old data forever just because the key already has a fulfilled promise.

Lane needs enough lifecycle information to support mount-time reload policies,
such as:

- reuse fresh data on mount
- reload stale data on mount
- always reload on mount when the product wants the strongest convergence
- preserve the existing promise when the app explicitly chooses no mount reload

This requires freshness metadata in the entry. A wrapper cannot reliably infer
freshness across loaders, seeds, sets, updates, and shared readers without
duplicating Lane's internal state.

### 2. Catch Up After Tab Focus Or Network Reconnect

When a user returns to a browser tab or the network comes back, active screens
should be able to catch up to server state.

Lane should make it possible for an adapter to reload active stale entries on
focus or reconnect. Lane core does not need to install browser event listeners
itself, but it does need to know which entries currently have active readers and
which of those entries are stale.

The simple policy "focus always invalidates everything" can be implemented
outside core today. The useful policy is narrower:

- only entries currently observed by mounted readers
- only entries whose freshness policy says they are stale
- no duplicate reloads when multiple readers observe the same key

### 3. Keep RSC-Seeded Initial UI Fast Without Trusting Seeded Data Forever

In the RSC-seeded client ownership architecture, initial data can be loaded on
the server and seeded into Lane on the client.

The app should get the fast initial render benefit without forcing either of
these poor choices:

- trust seeded data forever until explicit invalidation
- always refetch immediately after hydration, even when the seed is fresh enough

Lane therefore needs seeded entries to carry enough freshness information for a
mount-time policy to decide whether to reuse or reload them.

### 4. Do Not Retain Inactive Data Forever

Long-running sessions may visit many task filters, detail panels, teams, and
workspace views. Data that is no longer observed should eventually be removable
without requiring every application to hand-write cleanup rules for normal cache
growth.

Lane already supports explicit `remove` and `removeAll` for hard ownership
boundaries such as sign out, team switch, or deleted entities. Query lifecycle
GC is different: it is about entries that are merely inactive.

Supporting this requires observer counts and inactive timestamps in or near the
core entry lifecycle. A higher-level policy can decide the actual GC timeout.

### 5. Recover From Transient Read Failures

For temporary network failures, the application should be able to recover
without requiring a full page reload.

Lane already supports manual retry through invalidation. Automatic retry can be
added later as policy, but it will need reliable error metadata if it should
avoid duplicate attempts and respect mount/focus behavior.

This is lower priority than freshness and observer lifecycle because scoped
manual retry is already expressible today.

### 6. Keep Mutation Convergence Predictable

After user actions mutate server data, related views should converge:

- list variants
- selected detail entries
- summaries and insights
- exact entries populated by authoritative mutation responses

This remains Lane's existing center of gravity. Exact invalidation, scoped
invalidation, `set`, `update`, and removal should continue to be the primary
mutation convergence tools.

The lifecycle work should not replace explicit mutation convergence. It should
cover time- and activity-based freshness gaps around mounted reads.

## Core Boundary

Lane core should own lifecycle facts that must be consistent for a key slot:

- canonical key identity
- the optional cached promise for that key
- the cached promise start timestamp
- the cached promise settlement timestamp and kind
- exact-key subscriptions

These are promise-cache facts, not query result state. Lane should not keep a
separate resolved-value store, a "current data" object, or React Query-style
status fields in core.

Lane core should keep lifecycle policy separate from `readOrCreate`.
`readOrCreate` should only return an existing cached promise or create a promise
for an entry whose cache is empty. It should not decide freshness, invalidation,
or reload policy.

Invalidation should clear the cached promise and notify mounted readers to read
again. The first mounted reader that calls `readOrCreate` creates the next
promise; other readers for the same key reuse it. This keeps duplicate fetch
prevention inside the normal promise-cache path instead of adding a separate
reload state machine.

Lane core should not own high-level policy:

- browser focus listeners
- online or reconnect listeners
- polling timers
- retry and backoff strategy
- default option merging
- mutation state
- optimistic rollback
- `useQuery`-style result objects

Those policies can live in React adapters or provider-level helpers that call
the small core primitives.

## API Direction

Public React APIs may look familiar where that reduces application friction.
For example, options such as `staleTime`, `refetchOnMount`,
`refetchOnWindowFocus`, `refetchOnReconnect`, `gcTime`, and `retry` are not
philosophically important names to avoid.

The implementation boundary matters more than the option names:

```txt
React adapter option
-> conditional cache invalidation
-> mounted readers call readOrCreate through the existing subscription path
```

This keeps the core data structure simple while allowing applications to opt
into familiar behavior.

## Minimal Core Additions To Explore

The smallest useful core addition is to split a key slot from the cached promise:

```ts
type LaneEntry = {
  key: LaneKey;
  keyId: string;
  cache?: LanePromiseCache;
  invalidateListeners: Set<LaneSubscription>;
  removeListeners: Set<LaneSubscription>;
  inactiveSince?: number;
};

type LanePromiseCache = {
  promise: Promise<unknown>;
  startedAt: number;
  settlement?: {
    kind: "fulfilled" | "rejected";
    at: number;
  };
};
```

`LaneEntry` is the durable key slot. It can remain alive while a component is
mounted even when `cache` is empty. `LanePromiseCache` is the optional cached
promise record. Settlement metadata belongs to the cache record so that it
cannot drift away from the promise it describes.

Invalidation clears `entry.cache` rather than replacing it immediately:

```txt
invalidate(key)
-> entry.cache = undefined
-> notify subscribers
-> each mounted subscriber calls readOrCreate(key, loader)
-> the first subscriber creates the next promise
-> later subscribers reuse that promise
```

This removes the need for a public low-level reload operation, a version field,
or a separate invalidated flag. If an older promise settles after `entry.cache`
has been cleared or replaced, the settlement handler compares cache object
identity and does not mutate the current cache record.

Conditional lifecycle behavior such as mount-time stale refresh should use the
same invalidation path:

```txt
if entry.cache is stale for the reader policy
-> clear entry.cache
-> notify subscribers
-> subscribers re-read through readOrCreate
```

This keeps duplicate fetch prevention in one place and avoids storing loaders in
Lane core.

The exact public API names are intentionally left open. The requirement is that
higher layers can implement lifecycle policies without making Lane core own
browser events, retry strategy, polling timers, or query result objects.

## Initial Priority

Implement in this order:

1. Split `LaneEntry` from its optional `LanePromiseCache`.
2. Make invalidation clear `entry.cache` and notify readers to re-read.
3. Store promise settlement metadata inside `LanePromiseCache`.
4. React adapter support for mount-time stale invalidation.
5. Reader lifecycle metadata for active and inactive entries.
6. Provider or adapter support for focus and reconnect stale invalidation.
7. Inactive entry garbage collection.
8. Automatic retry policy, if manual retry is not enough for product needs.
