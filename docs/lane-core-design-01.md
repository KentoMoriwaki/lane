# Lane Core Design 01

This note captures the first minimum design for Lane. The current target is the
label search and creation flow in `apps/todo-nextjs-lane`.

## Goal

Lane starts as a tiny async coordination layer for React Suspense and
transitions.

The minimum unit Lane caches is a `Promise`, not resolved data.

```ts
Map<Key, Promise<T>>
```

React reads the promise with `use(promise)`.

```tsx
function LabelOptions() {
  const labelsPromise = useLanePromise(labelsKey, fetchLabels);
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

Lane should not become an SWR-like external data store in the first version.
It also should not become a React replacement layer. The point is to compose
with React primitives, not to wrap them in less transition-compatible copies.

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
const [_state, createLabelAction, isPending] = useActionState(
  async (_previousState, formData: FormData) => {
    await postLabel(readLabelName(formData));

    lane.refresh(labelsKey, fetchLabels);

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
  key: LaneKey,
  loader: () => Promise<T>,
): Promise<T> {
  const stableKey = serializeKey(key);
  const [promise, setPromise] = useState(() => lane.get(key, loader));

  useEffect(() => {
    const unsubscribe = lane.subscribe<T>(key, (nextPromise) => {
      setPromise(nextPromise);
    });

    const latestPromise = lane.get(key, loader);

    if (latestPromise !== promise) {
      startTransition(() => {
        setPromise(latestPromise);
      });
    }

    return unsubscribe;
  }, [stableKey, loader, promise]);

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
  const labelsPromise = useLanePromise(labelsKey, fetchLabels);

  const [_state, createLabelAction, isPending] = useActionState(
    async (_previousState, formData: FormData) => {
      const name = readLabelName(formData);

      await postLabel(name);

      lane.refresh(labelsKey, fetchLabels);

      return { ok: true };
    },
    { ok: false },
  );

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
            assignedLabels={assignedLabels}
            createLabelAction={createLabelAction}
            isPending={isPending}
            changeTaskLabelsAction={changeTaskLabelsAction}
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
  createLabelAction,
  isPending,
  changeTaskLabelsAction,
}: LabelOptionsProps) {
  const labels = use(labelsPromise);

  const filteredLabels = filterLabels(labels, query);
  const canCreate = canCreateLabel(labels, assignedLabels, query);

  return (
    <div role="listbox">
      {filteredLabels.map((label) => (
        <button
          key={label.id}
          type="button"
          onClick={() =>
            changeTaskLabelsAction({
              type: "assign",
              labelId: label.id,
            })
          }
        >
          {label.name}
        </button>
      ))}

      {canCreate ? (
        <form action={createLabelAction}>
          <input type="hidden" name="name" value={query} />
          <button disabled={isPending} type="submit">
            Create "{query.trim()}"
          </button>
        </form>
      ) : null}
    </div>
  );
}
```

The create action does not await the refreshed labels promise.

```ts
lane.refresh(labelsKey, fetchLabels);
```

The refreshed promise is delivered to subscribers. Their local promise state is
updated by the subscription, and `use(labelsPromise)` handles suspension during
render.

## Multiple Consumers

If two components read the same key, each component owns its own promise state:

```tsx
const labelsPromise = useLanePromise(labelsKey, fetchLabels);
```

They do not share local React state. They share the Lane promise store and the
per-key subscription.

When `lane.refresh(labelsKey, fetchLabels)` runs, Lane notifies only subscribers
for `labelsKey`. Each subscriber receives the same new promise identity and
updates its own state in a transition.

This avoids a broad Context update while still keeping all consumers of the same
key aligned.

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
- Suspense boundary

Suspense child:

- `use(labelsPromise)`
- derived filtering
- option rendering

## Open Questions

- How should keys be serialized, and how strict should key equality be?
- Should `refresh` dedupe if a refresh for the same key is already pending?
- Should query promises ever be evicted?
- Should `subscribe` call the listener immediately, or should the hook always
  perform its own post-subscribe sync?
