# Environments (CLI, React Native, and other renderers)

Lane is a React library, not a DOM library. It runs anywhere React runs — the
browser, **React Native**, an **Ink** CLI, or any other React renderer — because
it leans on React core (`use`, Suspense, `useTransition`, `useEffectEvent`), never
on `react-dom`.

The throughline: **the store and the hooks are environment-agnostic; the only
environment-coupled input is where focus / reconnect signals come from**, and that
is a single injectable prop.

## What is portable, and the one seam

| Layer | Environment coupling |
| --- | --- |
| Store (`createLane`, reads, invalidation, GC) | None. Plain `Promise` / `Map` / `AbortController` / timers; Node's `unref` is feature-detected. |
| Hooks (`useLane`, `useLanesAll`, `LaneHydration`) | None. DOM-free React. |
| **Focus / reconnect revalidation** | **The only seam.** `LaneProvider` reads these from an [`eventSource`](#the-eventsource-prop); the default uses browser events. |

So making Lane work off the web is not a port — it is choosing (or writing) an
event source. Everything else is unchanged.

## Requirements

Lane requires **React 19.2+** in whatever renderer you use (it uses the stabilized
`useEffectEvent`, which is part of React core and renderer-agnostic — no
`react-dom` involved). Concurrent features that Lane builds on — `use(promise)`
with Suspense, and `useTransition` — must be actually supported by the renderer;
see the per-environment notes below.

## The `eventSource` prop

`LaneProvider` accepts an `eventSource` that supplies the "app came to the
foreground" and "network reconnected" signals. The provider owns the *policy*
(focus throttling, fanning out to readers); a source owns only the *signal*.

```ts
type LaneEventSource = (handlers: {
  onFocus: () => void;
  onReconnect: () => void;
}) => (() => void) | void; // returns a cleanup, or nothing
```

Three sources ship with Lane (all stable references — pass them directly):

| Source | Environment |
| --- | --- |
| `domEventSource` (default) | Browser. `focus` / `visibilitychange` / `online`, feature-detected so it no-ops off the web. |
| `noopEventSource` | Anything with no focus/reconnect concept (a CLI). Emits nothing. |
| `createReactNativeEventSource({ AppState, netInfo? })` | React Native. |

> **Pass a stable reference.** `eventSource` is a provider effect dependency, so a
> fresh function each render re-subscribes. Use a shipped source (a module
> constant) or build a custom one once at module scope / in a memo.

## CLI (Ink)

Ink is a React renderer for the terminal. Lane runs under it directly.

- **Ink 7 + React 19.2.** Ink 7 already requires React ≥19.2 (it uses
  `useEffectEvent` internally), so Lane's requirement adds nothing.
- **Enable concurrency.** Ink's root is a legacy sync root by default; pass
  `render(<App />, { concurrent: true })` to get real `useTransition` deferral and
  concurrent Suspense. Without it, an initial read still suspends to a `Suspense`
  fallback, but transition re-reads (`isTransitionPending`) collapse to
  synchronous — acceptable for a terminal, but the transition-native behavior
  needs the flag.
- **No focus / reconnect.** A CLI has no window focus or network-reconnect
  concept, so use `noopEventSource` (the default already no-ops in Node — passing
  it just states the intent). `refetchOnFocus` / `refetchOnReconnect` then never
  fire; `invalidate`, `refetchOnMount`, `staleTime`, and polling work as always.

```tsx
import React, { Suspense, use } from "react";
import { render, Text } from "ink";
import { LaneProvider, useLane, noopEventSource } from "use-lane";

function User() {
  const { promise } = useLane({
    key: ["user", 1],
    loader: async ({ signal }) => {
      const res = await fetch("https://api.example.com/users/1", { signal });
      return res.json();
    },
  });
  return <Text>{use(promise).name}</Text>;
}

render(
  <LaneProvider eventSource={noopEventSource}>
    <Suspense fallback={<Text>Loading…</Text>}>
      <User />
    </Suspense>
  </LaneProvider>,
  { concurrent: true }, // real transitions + concurrent Suspense
);
```

## React Native

Lane runs under React Native on the New Architecture.

- **New Architecture (Fabric) required.** Suspense, transitions, and `use()` work
  only under the New Architecture, which is the default since **RN 0.76**. The
  legacy architecture (Paper) cannot run concurrent React.
- **React 19.2.** RN ships React 19.2 from **0.85+** — the clean path. Earlier
  lines bundle React 19.0 (RN 0.78) or 19.1 (RN 0.80–0.84), which lack the
  stabilized `useEffectEvent` Lane needs. On those, pin React to 19.2 with your
  package manager (npm `overrides`, yarn `resolutions`, `pnpm.overrides`) and test
  on your RN version — `react` is coupled to RN's bundled renderer, so verify the
  app mounts. Prefer moving to RN 0.85+ where possible.
- **Focus and reconnect** come from `AppState` (foreground) and, optionally,
  `@react-native-community/netinfo` (connectivity). You pass both native modules
  into `createReactNativeEventSource`, so Lane itself never imports `react-native`
  or NetInfo — no new dependency in Lane's graph. NetInfo is optional; omit it and
  only `refetchOnReconnect` is inactive.

```tsx
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { LaneProvider, createReactNativeEventSource } from "use-lane";

// Build once at module scope so the reference is stable.
const eventSource = createReactNativeEventSource({ AppState, netInfo: NetInfo });

export function Providers({ children }: { children: React.ReactNode }) {
  return <LaneProvider eventSource={eventSource}>{children}</LaneProvider>;
}
```

`AppState` → `onFocus` fires when the app returns to `"active"` from the
background. NetInfo → `onReconnect` fires on a disconnected → connected edge. Both
map straight onto `refetchOnFocus` / `refetchOnReconnect` for subscribed reads.

## Any other React renderer

The same seam generalizes. Write an `eventSource` that calls `onFocus` /
`onReconnect` when your environment signals them (or `noopEventSource` if it
doesn't) and return a cleanup:

```ts
import type { LaneEventSource } from "use-lane";

const myEventSource: LaneEventSource = ({ onFocus, onReconnect }) => {
  const off = platform.onResume(onFocus);
  const offNet = platform.onOnline(onReconnect);
  return () => {
    off();
    offNet();
  };
};
```

Nothing else about Lane changes across renderers — the store, keys, invalidation,
GC, retry, and staleness policies are identical everywhere.

## See also

- [API reference](./api-reference.md#event-sources) — `LaneProvider`, `LaneEventSource`, the shipped sources.
- [Frameworks & routers](./integrations.md) — wiring Lane to the thing that owns your URL.
- [Design notes](./design-notes.md) — why Lane is transition-native and DOM-free by construction.
