// Where "the app came back to the foreground" and "the network reconnected"
// signals come from. These are the only environment-coupled inputs Lane has —
// the store and the hooks are otherwise pure — so isolating them here is what
// lets `LaneProvider` run unchanged in the browser, a React Native app, an Ink
// CLI, or any other React renderer. The provider owns the *policy* (throttling,
// fanning out to readers); an event source only owns the *signal*.

/**
 * The two raw signals a source feeds back to the provider. They are unthrottled:
 * focus throttling is a provider concern (`focusThrottleInterval`) that applies
 * regardless of where the signal originates, so a source just fires.
 */
export type LaneRevalidateHandlers = {
  onFocus: () => void;
  onReconnect: () => void;
};

/**
 * Wires environment signals to Lane's revalidation. Called once inside the
 * provider's effect with the handlers to fire; returns a cleanup (or nothing).
 * A source that never fires simply disables focus / reconnect revalidation —
 * the correct behavior for a headless environment with no such concept.
 *
 * Pass a **stable reference** (a module-level constant, or one built once and
 * memoized): the provider lists it as an effect dependency, so a fresh function
 * every render re-subscribes needlessly. The shipped sources are stable.
 */
export type LaneEventSource = (
  handlers: LaneRevalidateHandlers,
) => (() => void) | void;

/**
 * The default source: browser `focus` / `visibilitychange` / `online` events.
 * Every access is feature-detected, so importing it (it is the provider default)
 * never throws in Node / Ink or React Native — it just no-ops where the globals
 * are absent. In the browser it is byte-for-byte the previous behavior.
 */
export const domEventSource: LaneEventSource = ({ onFocus, onReconnect }) => {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }

  const hasDocument = typeof document !== "undefined";

  const handleFocus = () => onFocus();
  const handleOnline = () => onReconnect();
  const handleVisibility = () => {
    if (hasDocument && document.visibilityState === "visible") {
      onFocus();
    }
  };

  window.addEventListener("focus", handleFocus);
  window.addEventListener("online", handleOnline);
  if (hasDocument) {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  return () => {
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("online", handleOnline);
    if (hasDocument) {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
};

/**
 * A source that emits nothing. Use it to opt out of focus / reconnect
 * revalidation explicitly — e.g. in a CLI, where neither concept exists (the
 * default already no-ops there, but passing this states the intent), or in a
 * browser surface where you deliberately do not want focus revalidation.
 */
export const noopEventSource: LaneEventSource = () => undefined;

type NativeSubscription = { remove: () => void };

/**
 * The structural shape of React Native's `AppState`. Declared structurally so
 * Lane depends on neither `react-native` nor its types — the app passes the real
 * module in.
 */
export type ReactNativeAppState = {
  currentState: string;
  addEventListener: (
    type: "change",
    handler: (state: string) => void,
  ) => NativeSubscription;
};

/**
 * The structural shape of the slice of `@react-native-community/netinfo` used
 * for reconnect. Optional — omit it and only focus revalidation is wired.
 */
export type ReactNativeNetInfo = {
  addEventListener: (
    handler: (state: { isConnected: boolean | null }) => void,
  ) => () => void;
};

export type ReactNativeEventSourceOptions = {
  AppState: ReactNativeAppState;
  netInfo?: ReactNativeNetInfo;
};

/**
 * Build a source for React Native. Focus maps to `AppState` returning to
 * `"active"` (foreground); reconnect maps to NetInfo transitioning to connected,
 * if a NetInfo module is supplied. Both native APIs are passed in rather than
 * imported, so this stays dependency-free and web bundles never pull in
 * `react-native`. Note the two unsubscribe shapes it reconciles: `AppState`
 * hands back `{ remove() }`, NetInfo a bare `() => void`.
 *
 * ```ts
 * import { AppState } from "react-native";
 * import NetInfo from "@react-native-community/netinfo";
 * const eventSource = createReactNativeEventSource({ AppState, netInfo: NetInfo });
 * // <LaneProvider eventSource={eventSource}>…</LaneProvider>
 * ```
 */
export function createReactNativeEventSource({
  AppState,
  netInfo,
}: ReactNativeEventSourceOptions): LaneEventSource {
  return ({ onFocus, onReconnect }) => {
    // Fire only on a transition *into* the foreground, not on every state change
    // (iOS also emits the transient "inactive"). Seed from the current state so a
    // source created while already active does not fire spuriously.
    let previousState = AppState.currentState;
    const appSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && previousState !== "active") {
        onFocus();
      }
      previousState = nextState;
    });

    let unsubscribeNetInfo: (() => void) | undefined;
    if (netInfo) {
      // Fire only on a false → true edge, so the initial event (and staying
      // connected) does not count as a reconnect.
      let wasConnected: boolean | null = null;
      unsubscribeNetInfo = netInfo.addEventListener((state) => {
        if (state.isConnected === true && wasConnected === false) {
          onReconnect();
        }
        wasConnected = state.isConnected;
      });
    }

    return () => {
      appSubscription.remove();
      unsubscribeNetInfo?.();
    };
  };
}
