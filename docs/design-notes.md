# Design notes

Why Lane is shaped the way it is. **Promise-first. Transition-native.** For
*how* to use it, see the [API reference](./api-reference.md); for where it fits,
see [supported architectures](./architectures.md).

The throughline: **the promise is the state. Lane owns promise identity; React
owns UI state.** Every decision below follows from keeping that split clean.

## Source invalidation is the primary convergence model

Lane makes source invalidation the main way to converge after a mutation:

```txt
mutate source -> invalidate affected read -> render from the next promise
```

This mirrors the Server Component model (`mutate -> revalidate -> render from the
next data`). A Lane app usually thinks "this source changed; read it again"
rather than "patch this external cache."

Invalidation is render-driven. Lane does not eagerly refetch away from render the
way a query cache can. When an entry is invalidated, mounted readers re-read in a
transition and create the next promise from their current loader; inactive
entries stay invalidated and fetch when next read. That is why Lane core never
has to store loaders for later refetch — the reader that owns the read provides
the loader.

## Transition-native by construction

Lane keeps each key's promise in React state (via `useState` + `useTransition`),
not in an external store read during render. That single choice is what makes
updates transition-native: when an entry is invalidated, set, or refetched, the
hook swaps the promise inside `startTransition`, so React keeps rendering the
last value until the next one resolves, then commits. The previous screen stays
mounted and interactive — no fallback flash, no tearing.

Because the data lives in React state, this is not a bespoke `keepPreviousData`
flag like a query cache needs; it is the same transition model the rest of the
app already uses. Callers compose it directly: wrap a filter change in
`startTransition`, or derive the key and loader from a `useDeferredValue` input,
and deferred behavior falls out for free. Background revalidations (focus, mount,
polling, reconnect) run on a separate transition surfaced as `isBackgroundPending`,
so automatic refreshes never block an interaction.

Two deliberate exceptions keep the claim honest: an initial load with no prior
value suspends to a Suspense fallback — a transition can only preserve UI that
already exists — and `remove` is urgent rather than transition-preserving, so
stale data cannot linger after sign-out or a team switch.

## Cancelling is for reads you own

Abort is normally a *consequence* rather than an operation. The `signal` a loader
receives fires in four places, and all four are moments when the in-flight cache
stops being the entry's cache: `invalidate` and `remove` clear it, `set` replaces
it with an authoritative value, and GC evicts it. `update` deliberately does not
abort — it chains onto the in-flight value, so the read it adopts has to stay
alive. That is also why an appended page in `useInfiniteLane` has no signal at
all: it arrives through `update`, and an updater is handed the current value, not
a controller.

`cancel` is the one exception, and it proves the rule rather than breaking it: it
leaves the cache in place precisely *so that* the settlement handlers still run,
and reads `cancelled` there to decide where the key lands. A transition has no
third outcome — it commits, or it commits an Error Boundary — so a cancelled read
still has to settle into one of those. With a previous value it folds into that
value; with nothing to revert to it settles rejected, because that is the only
end a transition holding no data can reach.

Emptying the entry instead looks tidier and quietly undoes the cancel. A reader
mid-transition is still trying to reach the key it was told to go to; React
retries the render it never committed, and an empty entry turns that retry into a
fresh load — one aborted request plus a replacement, which is worse than not
having cancelled. Keeping the rejection is what lets the retry terminate. It is
then as sticky as any other failed first load, and recovers the same way, which
is deliberately not special-cased.

The race that a cancel API usually exists to solve does not arise here, so
stopping is all it is for. Elsewhere cancellation is load-bearing just before an
optimistic update — a refetch that started before the mutation must not land after
it and overwrite the result. Lane closes that path structurally instead: `set`
aborts and publishes in one step, `update` chains rather than races, and
`invalidate(key, { after })` gates the re-read on the action. A response that
arrives late regardless writes into a cache object the entry no longer holds, and
is ignored.

**So `cancel` is for a read the caller started and can still account for.** Not
"stop whatever is in flight under this key" — that reading is what makes it
dangerous, and the two conditions behind it are both about the call site rather
than about the cache:

- **you issued this read** — your own `invalidate`, a load you are explicitly
  offering to stop, a key whose parameters you know are spent
- **nothing else reads this key** — `cancel` is addressed by key, so on a shared
  key you can stop your own refresh and a stranger's first load with the same call

Which is also why there is no `cancelAll`: the scoped twins exist for operations
that converge on every key they touch, and cancelling an unenumerated family
would leave a rejection on an unknown number of them. `useLane` returns no bound
`cancel` either. Binding one to the reader's own key would be the safest possible
form of it — but every reader would carry it and almost none would call it, which
is the wrong trade for a hook result.

A superseded read fails the first condition, which is why switching tabs or
retyping a search is the wrong place for it. Nobody *issued* those requests: the
caller changed some state, React decided to render it, and Lane read what the
render asked for. The request is a downstream consequence of a render the caller
does not control — and React reports an abandoned render to nobody, so there is no
event to hang a cancellation on either. Reads are created during render and
subscriptions during an effect, so a transition that never commits leaves an entry
that was read but never subscribed: no unsubscribe, no cleanup, nothing.

That is not a gap to be closed. Keying a request by identity is what makes
starting it during render acceptable at all, because a re-run reuses the work
instead of repeating it — but idempotent re-runs are not reversible runs, and
nothing un-starts a request whose render was thrown away. Speculative rendering
means speculative requests, and letting them finish is the right default rather
than the convenient one: React comes back to abandoned keys — a deleted character
restores the previous query — and reuses the in-flight read when it does.
Collection is left to `gcTime` because the timescales do not match either:
garbage collection is correct if it happens eventually, cancellation is worthless
unless it happens now.

Ownership cannot be a runtime check, and deliberately so. Lane exposes no way to
ask what a key holds, and an option like `onlyIf: "revertable"` — cancel, but only
where it happens to be safe — would make the same button stop the request or not
depending on whether the load had committed a moment earlier, which the caller
cannot observe. `invalidate`'s `onlyIf` works because both of its outcomes
converge; cancelling's do not. The rule belongs where the knowledge is: at the
call site, checked by whoever writes it.

Resource saving is a side effect and not the point. A stopped request does spare
the bandwidth, the radio, and — only if the server bothers to notice the closed
connection — the server's work. But framing `cancel` that way invites exactly the
broad, speculative use the conditions above rule out.

## React owns UI state

`useLane` deliberately returns no query-result fields — no `data`, `error`,
`isLoading`, `isError`, `isSuccess`, or `status`. Data is read with
`use(promise)`, loading is a `Suspense` fallback plus transition pending state,
and errors go to Error Boundaries. There is no parallel state machine to keep in
sync with React's own.

For the same reason **Lane ships no mutation helper**. Mutations are written with
React primitives — `useActionState`, `useOptimistic`, transitions — exactly as
they are next to Server Components and Server Functions. One mental model is worth
more long-term than a convenient wrapper that diverges from it.

## Optimistic state is local

React Query-style optimistic updates often write speculative data into the shared
cache, making it visible to every consumer until rollback. Lane does the
opposite: optimistic state stays local to the component or workflow that started
the action, via `useOptimistic`. The rest of the app keeps rendering current
promise-backed data until the source is invalidated and re-read, or an
authoritative value is published.

The tradeoff is intentional:

- optimistic UI stays close to the action that produced it
- Lane needs no global optimistic cache and no rollback/revert semantics
- distant consumers never observe speculative data
- app-wide consistency comes from confirmed data, not optimistic patches

## A loader's input includes what it already produced

A loader's contract is to produce **the value for a key** — not to fetch a
request. For most keys those are the same thing, which is why the loader was
handed only the key and an abort signal for so long. They come apart as soon as a
value is *accumulated*: a list the user has scrolled five pages into is still one
value under one key, but reproducing it takes five requests, and which five is a
fact about the value rather than about the key.

That fact has to live somewhere. The three places it can go are the key, the
component, or the value, and only the last one holds:

- **In the key** — `["feed", filters, depth]` — every depth is a different cached
  list, so growing the list evicts the one being read and scrolling becomes a
  cache-miss generator. It also makes "the list" un-nameable for invalidation.
- **In the component** — a ref or state incremented on each append — desyncs from
  the cache it describes the moment the two have different lifetimes. Remounting
  over a live cache is enough: the value comes back five pages deep and the
  component believes it holds one. We measured exactly that (see [common
  mistakes](./common-mistakes.md#holding-an-infinite-lists-depth-in-component-state)).
- **In the value** — the loader is handed `current`, the entry's last fulfilled
  value, and derives its work from it. Nothing to keep in sync, because there is
  no second copy.

So `current` is not a pagination feature. It is the general form of "re-read what
this key already holds," which the loader could not previously ask about: a
resume cursor, a revision for `If-None-Match`, a window that should keep its
extent. `useInfiniteLane` is one caller of it, and could be written in userland
because it uses nothing the core does not already expose.

Two properties keep it honest. It is **snapshotted when the read is created**, so
every retry of that read sees the same input and a value published mid-flight
cannot change what the read was started from. And it is **not a way to skip
work**: it is the previous read's value, so returning it unchanged strands the
entry on stale data with no way to notice — a loader that reads it still has to
produce the current value.

The lifetime is the entry's, which is what makes the rule learnable: `current`
survives invalidation (that clears the cached promise, not the value) and
disappears with the entry — on `remove`, on collection, and on an invalidation of
an entry no reader is holding. So a loader must always define what a first load
means, and `remove` genuinely forgets: it drops the last fulfilled value along
with the cache, so neither stale-on-error nor the next loader's `current` can
serve removed data back after a sign-out.

## Refresh errors serve stale data

A failed *refresh* must not destroy data the user is already looking at. When an
entry has a last fulfilled value and its next read rejects — after invalidation,
a focus refetch, polling, or a `set` of a rejecting promise — the cache falls
back:

- the cached promise resolves with `{ data, refreshError }` — the last fulfilled
  value plus the error — so `use(promise)` keeps rendering instead of throwing
- the failure rides *inside the resolved value*, not a side channel: a reader
  gets `data` and `refreshError` from the same `use(promise)`, so they can never
  tear apart under concurrent rendering, and nothing reads mutable store state
  during render
- freshness keeps the original fulfillment time, so staleness policies still
  treat the data as old and retry naturally
- the next successful read resolves to `{ data }` with no `refreshError`

Only initial loads — reads with no previous fulfilled value — reject and reach
the Error Boundary. This preserves the boundary model for "there is nothing to
show" while keeping "there is something to show" rendered through background
failures. `refreshError` is deliberately not named `error` for this reason.

Carrying the error in the resolved value (rather than exposing it as a separate
field on the hook result) is what makes this consistent: the promise is a single
React-state snapshot, and `use()` is the only read path, so `data` and
`refreshError` always reflect the same point in time.

## Authoritative publication is secondary

Invalidation is primary, but Lane can also publish already-confirmed data to an
exact key with `set` (and derive from the current value with `update`).
Conceptually `set` is a *prefilled invalidation*: store the next promise, then
notify subscribers through the same path. It is useful when the app already has
server-confirmed data and wants to avoid an immediate duplicate read — a create
response seeding a detail key, or an update response publishing the confirmed
entity while broader derived reads are invalidated.

`set` is not optimistic UI. It publishes data the app actually has.

## Hydration overwrites

`LaneHydration` applies server snapshots as authoritative values: it overwrites
existing entries and notifies subscribers. Navigation is the reason — when a
route transition re-hydrates the same keys with fresh server data, mounted
readers must converge. A set-only-if-absent seed would keep rendering the
previous page's data after navigation.

Idempotency lives at the boundary, not in the store operation: a given snapshots
instance is applied to a given lane at most once, so repeated renders and Strict
Mode do not re-publish. A new snapshots instance from a new server render is
intentionally authoritative.

Keying that on object *identity* is a deliberate bet on how snapshots reach the
boundary: produced outside render, once per data payload. A Server Component's
props satisfy that, and so does a router loader's data — both give exactly the
granularity the rule wants, one object per load and stable across the re-renders
of it, without hashing content or diffing entries, and without a "seeded already"
flag that would have to be reset on navigation. The bet has a cost, and it is not
a silent one: a caller who *builds* snapshots inside a render gets a new object
each time, so the boundary suspends on a fresh hydration promise every render and
never commits. That is the same shape as an inline
`Promise.all` in a suspending component, and it is documented next to the prop
rather than guarded at runtime, because the guard would have to be either a
content hash (which breaks authoritative re-seeding of unchanged data) or a
dev-only warning in a core measured in bytes.

## Key matching: exact vs scoped

Lane supports two matching modes, and the **caller** chooses which — Lane never
infers it from key shape:

- exact-key operations for one concrete read (`["task", id]`, `["labels"]`)
- prefix- or predicate-scoped operations for families of existing reads
  (`["tasks", filters]` invalidated through the `["tasks"]` prefix)

Scoped operations only touch entries that already exist; the app never enumerates
every key that could exist. Keys stay structural — the implementation derives a
canonical id for lookup but compares key *segments*, not raw string prefixes, for
scoped matching.

`remove` is distinct from invalidation: it means the entry no longer belongs in
client state (sign out, team switch, deleted entity), so its notification is
urgent rather than transition-preserving.

## A read is a value, not three arguments

`useLane(key, loader, options)` spreads one fact across three arguments, and the
argument list is the only thing holding them together. A shared key factory —
the usual first move — makes that worse before it makes it better: the key is now
defined once and the loader and options are still written at each call site, so
the halves can drift and nothing complains. `useLane(taskKeys.detail(id), () =>
fetchTasks(filters))` type-checks; two components can read one key with different
freshness; and the loader that actually fills the entry is whichever one mounted
first.

`laneRead({ key, loader, ...options })` makes the read itself the value that
travels. It is identity at runtime; the whole feature is where the types live.

**What travels is decided by what an operation needs.** A read needs the loader,
so `useLane`, `useLanesAll`, and `prefetch` take the whole definition. Publishing,
invalidating, and removing address an *entry* — the loader has nothing to do with
them, and requiring one would make every mutation path import fetchers, and
whatever request context those fetchers close over, to name a key it already
knows. So they take the key, and the loaded type rides along on it: a
`LaneKeyOf<T>` is the same array with the type in a phantom property, which is
what makes `set` and `update` checkable at all. (A key is otherwise where type
information goes to die: `["task", id]` says nothing about `Task`.) It is the same
mechanism as react-query's `DataTag`, and it is why the store needed no new
runtime to gain checked writes.

That split has a consequence worth stating: the type can be declared *without* a
read. `laneKey<T>(key)` exists for the write-only half of a codebase, and a read
built on such a key must load what the key claims — the colocation guarantee
running in the other direction.

Two boundaries keep it from becoming a second way to describe everything:

- **Scoped operations still take a scope.** `invalidateAll` answers a different
  question ("every entry under this prefix") and one read's full key is not an
  answer to it. Colocation does not change what
  [exact vs scoped](#key-matching-exact-vs-scoped) means.
- **There is no registry behind either helper.** Lane still addresses entries by
  serialized key, so two objects from the same factory name the same read and
  nothing has to be memoized, deduplicated, or registered at startup. Both
  helpers are worth nothing at runtime — which is exactly why they cost nothing:
  the core is byte-for-byte the store it was before, apart from `prefetch`
  learning to accept a read.

## Defaults belong to the instance

A read being one value says where its options live; it does not say what they are
when the read does not care. Most reads in an app want the same freshness, and
writing it on each one is not organization — it is a fact repeated at N sites,
free to drift at any of them. So `createLane({ defaults })` puts a floor under
`LaneUseOptions`, and a read only writes what it means to say differently.

**The floor is on the instance rather than in context**, and `prefetch` is the
reason. It runs outside React — a router loader, an RSC, a link's `onMouseEnter` —
so defaults that only reached `LaneProvider` would leave exactly the path that
cannot see context reading with the bare built-ins, and "app-wide" would be a
claim about the component tree instead of about the app. The instance is the one
thing every path already holds, which is where `gcTime` already lives. It also
removes a question a provider prop would have to answer: what `defaults` means
when a `lane` is passed too.

**Nothing is merged.** Options are not normalized into a copy anywhere in Lane —
a read *is* its options bag, read fresh at each render and each fire time — so the
defaults are resolved with `??` at the sites that already read each option: four
on the read path in core (`retry`, `retryDelay`, `staleTime`, `whenStale`) and
three at fire time in the hooks (`refetchOnMount` / `refetchOnFocus` /
`refetchOnReconnect`, which the store never sees, because "focus" is a DOM concern
the provider owns). A cache hit — the common case, once per render — therefore
allocates nothing, and the whole tier cost 29 bytes.

Resolving per option rather than per bag is also what makes the tier useful: a
read that turns `refetchOnFocus` on still gets the lane's `staleTime` to judge
freshness against, instead of having to restate it to keep the trigger honest.

Two consequences worth stating plainly:

- **`undefined` is *unspecified*, so a default cannot be un-set by writing
  nothing.** A read opts out by writing the built-in (`staleTime: 0`,
  `refetchOnFocus: false`). Distinguishing "absent" from "present and `undefined`"
  would mean `in` checks on every option, and would make the shape a hook happens
  to pass — an object whose unset options are present and `undefined` — carry
  meaning it was never designed to carry.
- **They are fixed at construction.** A default is read when a load starts and
  when a trigger fires, so a mutable one would be an external mutable source read
  during render, and it could never reach a promise the lane already cached. Policy
  that varies at runtime belongs at the read, or on a different instance —
  `useLane` already switches lanes during render.

**There is no per-key tier.** react-query pairs global defaults with
`setQueryDefaults(key, …)`; Lane's answer to "these options belong to this key" is
`laneRead`, which colocates them with the loader that makes the key mean
something. A key-prefix registry would put read policy back in the store — the one
thing the core is built not to hold (it keeps no loaders, and now no options
either) — and it would answer a question `laneRead` already answers, from further
away.

What is deliberately *not* defaultable: `gcTime`, because it is a lane policy with
no per-read counterpart to fall back from, and the `staleTime` on
`invalidate(key, { onlyIf: "stale", staleTime })`, because that is a threshold
argument to an operation rather than an option a read left unspecified. Folding a
default in there would make `{ onlyIf: "stale" }` mean different things per
instance while the entry's actual read policy — which core does not store — stayed
unknown. The rule stays one sentence: **a default fills in an option a read did
not specify.**

## A deliberately small core

Lane core owns only the lifecycle facts that must stay consistent for a key slot:
canonical identity, the optional cached promise, its start and settlement
timestamps, and exact-key subscriptions. It does **not** keep a separate
resolved-value store or `useQuery`-style status fields.

Everything time- or activity-based is policy layered over those primitives
through conditional invalidation, not baked into the core data structure:

```txt
adapter option -> conditional cache invalidation -> mounted readers re-read through the existing subscription path
```

- mount-time stale refresh (`refetchOnMount`)
- focus / reconnect revalidation (`refetchOnFocus`, `refetchOnReconnect`)
- polling — userland: a self-scheduled `invalidate(key, { onlyIf: "settled", background: true })` (no core timer)
- retry / backoff (`retry`, `retryDelay`)
- inactive-entry garbage collection (`gcTime`, a per-lane policy on `createLane`)
- app-wide read defaults (`createLane({ defaults })`) — held as given on the lane
  and resolved where each option is already read, never stored per entry

Splitting the durable key slot from its optional cached promise is what makes
this work: invalidation clears the cache and notifies readers; the first reader
to re-read creates the next promise and the rest dedupe onto it. No low-level
reload API, version field, or separate invalidated flag is needed, and stale
promises that settle late are ignored by comparing cache-object identity.

## Design bias

When more than one approach is possible, Lane prefers:

- invalidating source data over patching cache entries
- one definition per read over a key factory the loader has to be paired with
- an instance-owned floor under read options over policy stored per key
- the loaded type on the key, so addressing an entry never needs a loader
- exact-key operations for single reads, scoped operations for key families
- exact-key publication only for authoritative values already in hand
- local React state for optimistic UI, not shared cache writes
- aborting as a consequence of a cache transition, and cancelling only a read the
  caller issued
- app-level decisions for mutation effects
- coordinating promise identity over owning resolved-value cache policy

## See also

- [API reference](./api-reference.md)
- [Cross-reader consistency](./consistency.md) — the exact cost of keeping
  promises in React state instead of an external-store read
- [Common mistakes](./common-mistakes.md)
- [Supported architectures](./architectures.md)
