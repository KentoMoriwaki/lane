# Lane Core Design 01

This note captures the first minimum design for Lane. The current target is the
label search and creation flow in `apps/todo-nextjs-lane`.

## Goal

Lane starts as a tiny async coordination layer for React Suspense and
transitions.

The core value is that Lane is a transition-native client data loading layer
that fits next to Server Components instead of competing with them.

Server Components should own data that must be server-rendered. That data should
be updated through Server Functions, Server Actions, revalidation, or an RSC
refresh. Lane should own data that only becomes relevant on the client: focused
controls, client-only async islands, local optimistic workflows, and distant
client consumers that need to observe the same promise refresh.

Both sides keep the same mental model: React renders from promises.

```tsx
// Server Component owner
const labels = await getLabels();

return <Labels labels={labels} />;
```

```tsx
// Client Component owner
const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);
const labels = use(labelsPromise);

return <Labels labels={labels} />;
```

This is why Lane should not grow into an SSR data framework. If a piece of data
needs to be server-rendered as route or page data, the Server Component tree is
the right owner. Lane exists for the client-owned half of the app while keeping
the same Suspense, Error Boundary, action, optimistic, and transition primitives.

The minimum unit Lane caches is a `Promise`, not resolved data.

```ts
Map<Key, Promise<T>>
```

React reads the promise with `use(promise)`.

```tsx
function LabelOptions() {
  const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);
  const labels = use(labelsPromise);

  return null;
}
```

Pending is handled by Suspense. Errors are handled by Error Boundaries.
Mutation pending state is handled by React APIs such as `useActionState`.

The strongest idea in this design is full transition compatibility. Lane should
not invent its own mutation state, optimistic state, or loading state APIs. React
already has transition-aware primitives for those jobs.

- data pending: `Suspense`
- data errors: Error Boundaries
- form and mutation pending: `useActionState`
- optimistic UI: `useOptimistic`
- transition scheduling: `startTransition`

Lane only coordinates promise identity. The UI state remains React state.

## Non Goals

This first design does not include:

- resolved value cache
- stale time
- focus revalidation
- polling
- optimistic cache patching
- `useMutation`
- `useQuery` result objects such as `{ data, error, isLoading }`
- Lane-owned optimistic state
- Lane-owned mutation pending state
- global Context state for all queries
- subscriber notifications for resolved values
- SSR hydration for Server Component-owned data

Lane should not become an SWR-like external data store in the first version.
It also should not become a React replacement layer. The point is to compose
with React primitives, not to wrap them in less transition-compatible copies.
Lane also should not hydrate Server Component data into a client cache by
default; that creates two owners for the same data.

## Why Promise Only

SWR-style libraries usually keep resolved data in an external cache and notify
subscribers when that cache is written.

That makes cache writes a UI update source:

```ts
cache.set(labelsKey, nextLabels);
notify(labelsKey);
```

For this design, that is exactly what we want to avoid. React should own the
rendering transition. Lane should only provide the next promise identity.

The promise itself already remembers its fulfilled value internally. JavaScript
cannot synchronously read that value through a normal public API, but React can
unwrap it with `use(promise)` during render.

So Lane does not need this:

```ts
{
  status: "success",
  value: labels,
}
```

Lane only needs this:

```ts
{
  promise: Promise<Label[]>,
}
```

## Why No Lane Mutation State

Common data libraries expose APIs like this:

```tsx
const mutation = useMutation(createLabel, {
  onSuccess(label) {
    cache.set(labelsKey, (labels) => mergeLabel(labels, label));
  },
});
```

This design intentionally avoids that shape.

Mutation pending is already represented by `useActionState`.

```tsx
const [_state, createLabelAction] = useActionState(
  async (_previousState, formData: FormData) => {
    await postLabel(readLabelName(formData));

    startTransition(() => {
      labelLane.refresh(labelsKey, fetchLabels);
    });

    return { ok: true };
  },
  { ok: false },
);
```

Optimistic UI is already represented by `useOptimistic`.

```tsx
const [optimisticLabels, addOptimisticLabel] = useOptimistic(
  assignedLabels,
  reduceOptimisticLabels,
);
```

Lane does not need a `useMutation` hook, an optimistic cache patch API, or a
mutation status store. Lane also should not dedupe mutation calls by key. Those
would duplicate React primitives, add policy that belongs to application code,
and risk becoming less transition-compatible than the primitives themselves.

The rule is:

```txt
Lane manages promises.
React manages UI state.
```

When a `useActionState` dispatch is called imperatively instead of being passed
directly to a form `action` or button `formAction`, the call must be wrapped in
`startTransition`.

```tsx
function dispatchCreateLabel(name: string) {
  const formData = new FormData();

  formData.set("name", name);

  startTransition(() => {
    dispatchCreateLabelAction(formData);
  });
}
```

This is still React-owned mutation state. Lane does not get a mutation status
API because of this.

## Core API

The minimum core shape:

```ts
type LaneKey = readonly unknown[];

type Lane = {
  get<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  refresh<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  subscribe<T>(
    key: LaneKey,
    listener: (promise: Promise<T>) => void,
  ): () => void;
};
```

`get` returns the cached promise for a key. If there is no promise yet, it calls
the loader, stores the returned promise, and returns it.

`refresh` always calls the loader, stores the new promise for the key, notifies
subscribers for that key, and returns the new promise.

`subscribe` lets React components update the promise they hold in local state
when a key is refreshed.

## React Binding

The hook stores the promise identity in React state.

```tsx
function useLanePromise<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
): Promise<T> {
  const keyId = useMemo(() => serializeKey(key), [key]);
  const [promise, setPromise] = useState(() => lane.get(key, loader));

  useEffect(() => {
    const unsubscribe = lane.subscribe<T>(key, (nextPromise) => {
      setPromise(nextPromise);
    });

    const latestPromise = lane.get(key, loader);

    startTransition(() => {
      setPromise((currentPromise) =>
        currentPromise === latestPromise ? currentPromise : latestPromise,
      );
    });

    return unsubscribe;
  }, [lane, keyId, loader]);

  return promise;
}
```

The important part is that the mutable Lane store is not read as an implicit
render dependency. The component renders from its own `promise` state.

This avoids relying on unrelated state updates to make a component observe a
changed mutable value. That kind of hidden dependency is not a sound design with
the React Compiler.

## Component Usage

The parent component owns UI state, actions, and the labels promise identity. It
does not unwrap labels.

```tsx
function TodoLabelCombobox({
  assignedLabels,
  changeTaskLabelsAction,
}: Props) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticLabels, addOptimisticLabelMutation] = useOptimistic(
    assignedLabels,
    reduceOptimisticLabels,
  );
  const [optimisticCreatedLabels, addOptimisticCreatedLabel] = useOptimistic(
    [] as Label[],
    mergeLabel,
  );
  const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);

  const [_state, dispatchCreateLabelAction] = useActionState(
    async (_previousState, formData: FormData) => {
      const name = readLabelName(formData);

      await postLabel(name);

      startTransition(() => {
        labelLane.refresh(labelsKey, fetchLabels);
      });

      return { ok: true };
    },
    { ok: false },
  );

  function dispatchCreateLabel(name: string) {
    const formData = new FormData();
    const optimisticLabel = createOptimisticLabel(name);

    formData.set("name", name);
    setQuery("");

    startTransition(() => {
      addOptimisticCreatedLabel(optimisticLabel);
      dispatchCreateLabelAction(formData);
    });
  }

  function assignLabel(label: Label) {
    startTransition(async () => {
      addOptimisticLabelMutation({ type: "assign", label });
      await changeTaskLabelsAction({ type: "assign", labelId: label.id });
    });
  }

  function removeLabel(label: Label) {
    startTransition(async () => {
      addOptimisticLabelMutation({ type: "remove", labelId: label.id });
      await changeTaskLabelsAction({ type: "remove", labelId: label.id });
    });
  }

  return (
    <section>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />

      {isOpen ? (
        <Suspense fallback={<div>Loading labels</div>}>
          <LabelOptions
            labelsPromise={labelsPromise}
            query={query}
            assignedLabels={optimisticLabels}
            optimisticCreatedLabels={optimisticCreatedLabels}
            createLabel={dispatchCreateLabel}
            assignLabel={assignLabel}
            removeLabel={removeLabel}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
```

The Suspense child unwraps the promise it receives from the parent. It does not
own the Lane subscription.

```tsx
function LabelOptions({
  labelsPromise,
  query,
  assignedLabels,
  optimisticCreatedLabels,
  createLabel,
  assignLabel,
  removeLabel,
}: LabelOptionsProps) {
  const labels = use(labelsPromise);

  const visibleLabels = mergeVisibleLabels(labels, optimisticCreatedLabels);
  const filteredLabels = filterLabels(visibleLabels, query);
  const assignedLabelIds = new Set(assignedLabels.map((label) => label.id));
  const canCreate = canCreateLabel(visibleLabels, assignedLabels, query);

  return (
    <div role="listbox">
      {canCreate ? (
        <button type="button" onClick={() => createLabel(query.trim())}>
          Create "{query.trim()}"
        </button>
      ) : null}

      {filteredLabels.map((label) => (
        <button
          key={label.id}
          data-optimistic={label.isOptimistic ? "true" : undefined}
          data-selected={assignedLabelIds.has(label.id)}
          disabled={label.isOptimistic}
          type="button"
          onClick={() => {
            if (assignedLabelIds.has(label.id)) {
              removeLabel(label);
            } else {
              assignLabel(label);
            }
          }}
        >
          {label.name}
        </button>
      ))}
    </div>
  );
}
```

Created labels are optimistic only inside the combobox that initiated the
creation. They are merged into that combobox's visible options with
`mergeVisibleLabels`, marked with `data-optimistic`, and disabled until the
server label appears through the refreshed labels promise.

That optimistic state is intentionally not shared with the debug label list or
any other labels consumer. Sharing it would require an optimistic external cache,
which is outside Lane's responsibilities.

Assigned labels are also local optimistic UI. Clicking an unassigned option
assigns it. Clicking an assigned option removes it. The option remains enabled
so global disabled styling does not make selected labels look pending; only
created optimistic labels are disabled.

The create action does not await the refreshed labels promise.

```ts
labelLane.refresh(labelsKey, fetchLabels);
```

The refreshed promise is delivered to subscribers. Their local promise state is
updated by the subscription, and `use(labelsPromise)` handles suspension during
render.

## Multiple Consumers

If two components read the same key, each component owns its own promise state:

```tsx
const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);
```

They do not share local React state. They share the Lane promise store and the
per-key subscription.

When `labelLane.refresh(labelsKey, fetchLabels)` runs, Lane notifies only
subscribers for `labelsKey`. Each subscriber receives the same new promise
identity and updates its own state within the transition that called refresh.

This avoids a broad Context update while still keeping all consumers of the same
key aligned.

The sample app uses this with `DebugLabelList` on the left side. It mounts only
after the client has mounted, then calls
`useLanePromise(labelLane, labelsKey, fetchLabels)` independently from the
combobox. This keeps SSR out of scope while still verifying that distant client
consumers observe the same refreshed promise.

The current label combobox chooses to let the parent component own
`useLanePromise` because the create transition and the local optimistic created
labels also live there. A Suspense child can mechanically subscribe to the same
key as well, but the current sample keeps the promise identity at the component
that owns the transition-producing actions.

## Component Boundary

Component outside:

- `lane`
- cache keys
- loaders
- mutation functions
- key normalization
- pure helpers such as `filterLabels` and `canCreateLabel`

Component parent:

- input state
- open state
- `useActionState`
- `useLanePromise`
- `labelsPromise`
- local optimistic assigned labels
- local optimistic created labels
- create, assign, and remove actions
- Suspense boundary

Suspense child:

- `use(labelsPromise)`
- merge server labels with local optimistic created labels
- derived filtering
- option rendering
- create option rendering
- assigned option toggles remove

## Server Components And SSR

Lane is not trying to replace Server Component data loading.

If data is naturally owned by a Server Component, it should stay there:

```txt
Server Component fetch
-> props into Client Components if needed
-> mutation through Server Function or Server Action
-> revalidation or RSC refresh
```

Hydrating that same data into Lane would create a split ownership model:

```txt
initial owner: Server Component
later owner: Lane
```

That is not the default direction for this library.

The intended split is:

```txt
Server-rendered route or page data
=> Server Component owner

Client-only async data
=> Lane owner
```

This keeps the whole application transition-native without making every data
source go through the same cache. The writing style remains close because both
owners expose data through promises that React unwraps during render.

SSR support for client-owned Lane data is possible, but it is not part of this
minimum design. A future SSR API would need to preserve the same ownership rule:
it may serialize a fulfilled promise for a client-owned island, but it should
not become a hydration bridge for Server Component-owned route data.

## Open Questions

- How should keys be serialized, and how strict should key equality be?
- Should `refresh` dedupe if a refresh for the same key is already pending?
- Should query promises ever be evicted?
- Should `subscribe` call the listener immediately, or should the hook always
  perform its own post-subscribe sync?
- If client-owned Lane data ever supports SSR, what is the smallest API that can
  serialize fulfilled promises without introducing a resolved value cache?
