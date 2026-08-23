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
optimistic update — a refetch that started before the mutation must not land
after it and overwrite the result. Lane closes that path structurally instead:
`set` aborts and publishes in one step, and `update` chains rather than races.
A response that arrives late regardless writes into a cache object the entry no
longer holds, and is ignored.

**So `cancel` is for a read the caller started and can still account for.** Not
"stop whatever is in flight under this key" — the two conditions behind it are
both about the call site rather than about the cache:

- **you issued this read** — your own `invalidate`, a load you are explicitly
  offering to stop, a key whose parameters you know are spent
- **nothing else reads this key** — `cancel` is addressed by key, so on a shared
  key you can stop your own refresh and a stranger's first load with the same call

A superseded read — switching tabs, retyping a search — fails the first
condition. Nobody *issued* those requests: the caller changed some state, React
decided to render it, and Lane read what the render asked for. React reports an
abandoned render to nobody, so there is no event to hang a cancellation on
either; speculative rendering means speculative requests, and letting them
finish is the right default — React comes back to abandoned keys (a deleted
character restores the previous query) and reuses the in-flight read when it
does. Collection is left to `gcTime` / `warmTime` because the timescales do not
match: garbage collection is correct if it happens eventually, cancellation is
worthless unless it happens now.

Ownership cannot be a runtime check, and deliberately so. Lane exposes [no way
to ask what a key holds](#the-store-returns-promises-never-data), and an option
like `onlyIf: "revertable"` would make the same button stop the request or not
depending on state the caller cannot observe. The rule belongs where the
knowledge is: at the call site, checked by whoever writes it.

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

## Lane is not an API client

Lane never issues a request. A loader is your code calling your client, and
Lane's only contribution to it is the argument list. What belongs in Lane has a
factual answer rather than a stylistic one:

> To implement this correctly, must you know **(a)** what is on screen right
> now, **(b)** whether anyone is still reading, or **(c)** when React will
> commit?

If none of the three, the feature can be implemented correctly without Lane, and
putting it in Lane only takes away your choice of client.

**What the test admits.** Stale-on-error, `revision`, and structural sharing
need (a). Dedup, abort-on-discard, garbage collection, and focus / reconnect
revalidation need (b). Transition-native replacement needs (c).

**What it excludes.** Retry and backoff. Timeouts, rate limiting, circuit
breaking. Error reporting and telemetry. Auth token refresh, header and base-URL
policy. Response parsing and error normalization. Each is a function of one
request, answerable without
knowing anything about the render — so each belongs to the client you already
have, where it also applies to the requests Lane never sees.

**The boundary is a handoff, not a wall.** A loader receives
`{ key, signal, current, meta }`, and every one of those is something only Lane
knows: `signal` fires when the read is discarded, so work nobody is waiting for
stops; `current` is the last fulfilled value, so a conditional request can send
it as `If-None-Match`. Lane supplies the render-relative context; your client
makes the request.

## The store returns promises, never data

Every method on the `Lane` instance returns a promise or nothing. `prefetch`,
`set`, `update`, and `updateAll` hand back the promise a reader will `use()`;
`invalidate`, `invalidateAll`, `remove`, `removeAll`, and `cancel` return `void`.
There is no `get`, no `peek`, no `getQueryData` equivalent — nothing that answers
"what does this key hold" with a value.

That is the section above seen from the other side. `useLane` returns no `data`
field because the promise is the state; the store returns no value because a
value handed out beside `use()` is a second channel into the same data, and
nothing keeps the two agreeing.

**Concurrent rendering is what breaks the agreement.** Two readers of one key
under different Suspense boundaries commit on their own schedule: during a
transition one can already be showing the next value while the other still shows
the previous one. "What this key holds" has no single answer at that moment, so
a getter could only report the store's own state — which is neither reader's,
and an event handler consulting it reads a value the tree the user clicked may
not be showing.

**The last fulfilled value is not a way around it.** An entry does keep one, but
it exists to serve three recovery paths — the stale-on-error fallback, the
loader's [`current`](#a-loaders-input-includes-what-it-already-produced), and
where `cancel` reverts to — and its lifetime rules belong to them.

So the demand splits, and each half already has somewhere to go:

- **Derive the next value from the current one** — `update`, which chains onto
  the in-flight promise instead of racing it. It needs no getter because an
  updater is *handed* the value; that is how `useInfiniteLane` appends a page.
- **React to something from outside** (a socket patch, a push notification) —
  `set` or `update` for a message that carries the value, `invalidate` for one
  that only announces a change. Guarding either on "do I hold this key" is not
  worth an API: invalidation is render-driven, so an entry nobody reads stays
  invalidated and costs nothing until it is read.
- **Use the value in an event handler** — the component that rendered it passes
  it in. A handler that cannot reach the data is a question about component
  structure, and answering it from the store is exactly what puts the click and
  the screen out of step.
- **Show one key's value while another loads** — a transition already keeps the
  previous screen live, which is most of what a `getQueryData`-backed
  `initialData` is bought for. When a partial value genuinely should appear
  first, the caller has it in hand and `set` publishes it.

## The store states what it knows synchronously, and nothing more

A value that reaches the store as a value — `set(key, value)`, a
`<LaneHydration>` seed — is wrapped in a promise that is fulfilled before it is
returned, carrying `status` and `value`: React's promise cache protocol, written
out in the `use` reference under
["How to implement a promise cache"](https://react.dev/reference/react/use#how-to-implement-a-promise-cache).
`use()` reads it in the render that receives it rather than suspending once to
learn what it holds.

That exists for the one path that cannot wait a microtask. A reveal adopts the
store's promise from a layout effect, which is a synchronous update: React has
nowhere to wait, so it commits the boundary's fallback, and the retry runs on a
lane where fallbacks are throttled for 300ms. A value converged behind a hidden
tree would spend a third of a second announcing itself as loading — for data
that was already in hand when the tree was hidden.

**A promise is passed through untouched**, and that is the more important half
of the rule. A loader's result, `set(key, promise)`, an `update` chained onto
one, a `prefetch` — each is somebody else's promise, and the store has nothing
to say about it that it can say synchronously. Writing `"pending"` on one would
be a claim the store then owes a settlement for; React already writes all three
fields itself on a promise's first `use()`, and stops doing so the moment
`status` is a string, so a store that starts the protocol must finish it. Lane
declines to start. The cost is the ordinary one — a promise nothing has read
suspends once — and it is only visible where the adoption is synchronous, which
is the reveal, and where the fix is to hand the store a value instead.

The same principle runs through the rest of the store: no `get`, no `peek`, and
`update` chains onto the in-flight promise rather than racing it. Nothing here
answers a question with a value the store had to guess at.

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

- **In the key** — `["feed", filters, depth]` — every depth is a different
  cached list, and "the list" becomes un-nameable for invalidation.
- **In the component** — a ref incremented on each append — desyncs from the
  cache the moment the two have different lifetimes (see [common
  mistakes](./common-mistakes.md#holding-an-infinite-lists-depth-in-component-state)).
- **In the value** — the loader is handed `current`, the entry's last fulfilled
  value, and derives its work from it. Nothing to keep in sync, because there is
  no second copy.

So `current` is not a pagination feature. It is the general form of "re-read
what this key already holds": a resume cursor, a revision for `If-None-Match`, a
window that should keep its extent. `useInfiniteLane` is one caller of it.

Two properties keep it honest: it is **snapshotted when the read is created**,
and it is **not a way to skip work** — returning it unchanged strands the entry
on stale data. Its lifetime is the entry's: it survives invalidation (that
clears the cached promise, not the value) and disappears with the entry — on
`remove`, on collection, and on an invalidation of an entry no reader is
holding. So a loader must always define what a first load means, and `remove`
genuinely forgets: it drops the last fulfilled value along with the cache, so
neither stale-on-error nor the next loader's `current` can serve removed data
back after a sign-out.

## A failed load falls back before it rejects

A failure must not destroy data the user is already looking at. When an entry has
a last fulfilled value and its next read rejects — after invalidation, a focus
refetch, polling, or a `set` of a rejecting promise — the cache falls back:

- the cached promise resolves with `{ data, error }` — the last fulfilled
  value plus the error — so `use(promise)` keeps rendering instead of throwing
- the failure rides *inside the resolved value*, not a side channel: a reader
  gets `data` and `error` from the same `use(promise)`, so they can never
  tear apart under concurrent rendering, and nothing reads mutable store state
  during render
- freshness keeps the original fulfillment time, so staleness policies still
  treat the data as old and retry naturally
- the next successful read resolves to `{ data }` with no `error`

Only a load with nothing to serve rejects and reaches the Error Boundary. This
preserves the boundary model for "there is nothing to show" while keeping "there
is something to show" rendered through background failures.

Which of the two a failure is turns out to be the read's decision, not the
store's, and `fallback` is where it says so. The built-in behaviour above is one
policy — *serve the previous value, else reject* — and a read that declares its
own replaces it outright: a floor under the empty case for something
non-essential, or a refusal to serve a value that is not current for something
where staleness is itself wrong. Which is why the policy is handed the same two
facts this section decides from, and why it runs whether or not there is a
previous value: a rule that only sometimes applies is one nobody can read off the
definition.

Nothing a policy returns is stored. `lastFulfilled` moves only on a genuine
success, so the freshness and revision arguments above keep holding for a read
that never succeeds at all — which is also the argument against writing this as a
`try` / `catch` in the loader, where a substitute *is* a success and takes all
three with it.

Carrying the error in the resolved value (rather than exposing it as a separate
field on the hook result) is what makes this consistent: the promise is a single
React-state snapshot, and `use()` is the only read path, so `data` and
`error` always reflect the same point in time.

## Authoritative publication is secondary

Invalidation is primary, but Lane can also publish already-confirmed data to an
exact key with `set` (and derive from the current value with `update`).
Conceptually `set` is a *prefilled invalidation*: store the next promise, then
notify subscribers through the same path. It is useful when the app already has
server-confirmed data and wants to avoid an immediate duplicate read — a create
response seeding a detail key, or an update response publishing the confirmed
entity while broader derived reads are invalidated.

`set` is not optimistic UI. It publishes data the app actually has. That holds on
a published key too, and there it is the *same* operation: a client write of
confirmed data is not a fork of the truth, because the next publication states at
least what the write anticipated. Writing it locally only skips the wait for the
owner to say so.

## Hydration overwrites — and what that implies about ownership

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
props satisfy that, and so does a router loader's data. The bet has a cost, and
it is not a silent one: snapshots *built* inside a render are a new object each
time, so the boundary suspends on a fresh hydration promise every render and
never commits. It is documented next to the prop rather than guarded at
runtime, because the guard would have to be either a content hash (which
breaks authoritative re-seeding of unchanged data) or a dev-only warning in a
core measured in bytes.

**Authoritative is why a client write to a seeded key is safe, not why it is
refused.** A publication overwrites whatever it finds — which navigation
requires — so a local write's worst case is being restated. And the write the
client makes is a write of *confirmed* data: the mutation it came from has
already happened at the source, so the next publication states at least what the
write anticipated. Last publication wins, and the publication agrees.

What the client does not have is the rest of the answer. A change it made has
consequences it is not holding — a count, a re-sorted list, an insight derived
from three tables — and for those it says `invalidate`, which is a request, not a
value: the entry is emptied, and the next reader to need it asks the owner
through [`refresh`](./api-reference.md#refresh--the-owner-ask). That is the whole
of the client's authority over a published key: it may state what it has
confirmed, and it may say that something is no longer true. It may not decide
*when* the key goes stale — no `staleTime`, no `refetchOn*` — because that is a
second freshness policy over one key, which is exactly the shape this design
exists to avoid.

Two things follow about where the ask goes. It is fired by a **read**, not by
the invalidation: a router that discards a pending refresh when a navigation
starts (Next's does) would otherwise leave a wait nobody will ever fill, and a
key invalidated for a screen nobody is looking at would re-render a route for
nothing. And it is fired only for a key that has **held a value before** — a
first mount is waiting for a payload already on its way, and asking for it would
be asking twice.

The one pairing still refused at the read is a key that is both seeded and read
with a *client* loader. That is not about writes: it is two loaders for one key,
and whichever ran last decides what is stored. It warns in development, where
both halves of the mistake are visible.

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

A `useLane(key, loader, options)` signature would spread one fact across three
arguments, with the argument list the only thing holding them together. A shared
key factory — the usual first move — makes that worse before it makes it better:
the key is defined once while the loader and options are still written at each
call site, so the halves can drift and nothing complains — two components can
read one key with different freshness, and the loader that actually fills the
entry is whichever one mounted first.

`laneRead({ key, loader, ...options })` makes the read itself the value that
travels. It is identity at runtime; the whole feature is where the types live.

**What travels is decided by what an operation needs.** A read needs the
loader, so `useLane`, `useLanesAll`, and `prefetch` take the whole definition.
Publishing, invalidating, and removing address an *entry*, so they take the key,
and the loaded type rides along on it: a `LaneKeyOf<T>` is the same array with
the type in a phantom property, which is what makes `set` and `update` checkable
at all — the same mechanism as react-query's `DataTag`. The type can also be
declared *without* a read: `laneKey<T>(key)` exists for the write-only half of a
codebase.

Two boundaries keep it from becoming a second way to describe everything:
**scoped operations still take a scope** (one read's full key is not an answer
to "every entry under this prefix"), and **there is no registry behind either
helper** — Lane still addresses entries by serialized key, so two objects from
the same factory name the same read and nothing has to be memoized or registered
at startup.

## The dependency a loader needs is not part of the read

Binding a request context into the read factory is the natural first move —
`taskLanes(ctx).detail(id)` — and it breaks `.key`: naming an entry now requires
producing a request context, and the places that name entries are exactly the
places that do not have one (a mutation module, a Server Component seeding the
cache, an error-boundary retry). The reliable workaround is a second map of bare
keys, and that is the actual cost: **every read now exists twice**, with the
loaded type restated by hand and nothing checking that the two agree.

So the dependency goes on the **lane**, declared once by module augmentation and
delivered to loaders as `meta`:

```ts
declare module "use-lane" {
  interface LaneRegister { loaderMeta: Ctx }
}
```

A read stays a plain object whose arguments are exactly what decides its key, so
`.key` costs nothing to reach and there is one definition per read. The
alternatives were weighed and are worse: a third type parameter on
`LaneReadSpec` is paid for by every consumer (`useLane` overloads, per-member
annotations in `useLanesAll`), and a per-read field alone cannot be *required*,
so forgetting it degrades silently to `undefined`. This is
react-query's `Register`, with the value moved: react-query puts `meta` on the
query, Lane makes the lane's value mandatory and the per-read one an override —
which is what lets `meta` be non-optional in a loader.

Two consequences are load-bearing, and neither is hidden:

- **One type per app.** Module augmentation is program-wide, so an app has
  exactly one `loaderMeta` type.
- **It is not part of any key.** Two reads of one key under different meta name
  the same entry, and whichever loaded first wins. Nothing invalidates when the
  value changes, because the store has no way to know what the value owns. Scope
  what it owns into the key, or drop those keys yourself on a switch. The value
  is deliberately *outside* the key rather than quietly folded into it: a hidden
  key component would make every entry unaddressable from a module that cannot
  produce the context — the exact problem this solves.

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
- inactive-entry garbage collection (`gcTime`, a read option with a lane-level default on `createLane`; `warmTime` for entries nobody has ever held)

Splitting the durable key slot from its optional cached promise is what makes
this work: invalidation clears the cache and notifies readers; the first reader
to re-read creates the next promise and the rest dedupe onto it. No low-level
reload API, version field, or separate invalidated flag is needed, and stale
promises that settle late are ignored by comparing cache-object identity.

### What it costs

`dist/` is one file per source module, so a feature you do not import is dropped
whole rather than shaken statement-by-statement out of a shared bundle. Two
numbers follow from that, and they are the ones `size-limit` holds in CI —
minified, Brotli-compressed, `react` / `react-dom` external. The typical
`LaneProvider` + `useLane` import is about **3.8 kB**, and importing *every*
export is about **5.4 kB**: that ceiling is the whole of what Lane can cost you.

## Design bias

When more than one approach is possible, Lane prefers:

- invalidating source data over patching cache entries
- one definition per read over a key factory the loader has to be paired with
- the loaded type on the key, so addressing an entry never needs a loader
- exact-key operations for single reads, scoped operations for key families
- exact-key publication only for authoritative values already in hand
- local React state for optimistic UI, not shared cache writes
- aborting as a consequence of a cache transition, and cancelling only a read the
  caller issued
- request-level concerns in the fetcher over built-ins that own your HTTP stack
- app-level decisions for mutation effects
- coordinating promise identity over owning resolved-value cache policy

## See also

- [API reference](./api-reference.md)
- [Cross-reader consistency](./consistency.md) — the exact cost of keeping
  promises in React state instead of an external-store read
- [Common mistakes](./common-mistakes.md)
- [Supported architectures](./architectures.md)
