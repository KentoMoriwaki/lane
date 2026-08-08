// Focus / reconnect signals are Lane's only environment-coupled inputs. The
// provider owns policy (throttling, fan-out); a source only owns the signal.

/** Raw signals, unthrottled — focus throttling is the provider's concern. */
export type LaneRevalidateHandlers = {
  onFocus: () => void;
  onReconnect: () => void;
};

/**
 * Wires environment signals to Lane's revalidation; returns a cleanup (or
 * nothing). Pass a stable reference — it is an effect dependency in the
 * provider, so a fresh function every render re-subscribes.
 */
export type LaneEventSource = (
  handlers: LaneRevalidateHandlers,
) => (() => void) | void;

/**
 * Default source: browser `focus` / `visibilitychange` / `online` events,
 * feature-detected so it no-ops rather than throws off the web.
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

/** Emits nothing: explicit opt-out of focus / reconnect revalidation. */
export const noopEventSource: LaneEventSource = () => undefined;

type NativeSubscription = { remove: () => void };

/**
 * Structural shape of React Native's `AppState`, so Lane depends on neither
 * `react-native` nor its types; the app passes the module in.
 */
export type ReactNativeAppState = {
  currentState: string;
  addEventListener: (
    type: "change",
    handler: (state: string) => void,
  ) => NativeSubscription;
};

/** Structural slice of netinfo for reconnect; omit it and only focus is wired. */
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
 * Source for React Native: focus is `AppState` returning to `"active"`,
 * reconnect is NetInfo becoming connected. Modules are passed in, not
 * imported, so web bundles never pull in `react-native`.
 */
export function createReactNativeEventSource({
  AppState,
  netInfo,
}: ReactNativeEventSourceOptions): LaneEventSource {
  return ({ onFocus, onReconnect }) => {
    // Fire only on a transition *into* "active" (iOS also emits transient
    // "inactive"); seed from the current state to avoid a spurious first fire.
    let previousState = AppState.currentState;
    const appSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && previousState !== "active") {
        onFocus();
      }
      previousState = nextState;
    });

    let unsubscribeNetInfo: (() => void) | undefined;
    if (netInfo) {
      // Fire only on a false → true edge; the initial event is not a reconnect.
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
