export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

export type LaneLoaderContext = {
  key: LaneKey;
  signal: AbortSignal;
};

export type LaneLoader<T> = (context: LaneLoaderContext) => Promise<T>;

export type LaneRetryDelay = (attempt: number, error: unknown) => number;

export type LaneScope =
  | LaneKey
  | ((entry: { key: LaneKey; keyId: string }) => boolean);

export type LaneSnapshot<T = unknown> = {
  key: LaneKey;
  data: T;
};

export type LaneHydrationSnapshots = {
  entries: readonly LaneSnapshot[];
};

export type LaneEntryInfo = {
  key: LaneKey;
  keyId: string;
};

export type LaneUpdater<T> = (
  current: T,
  entry: LaneEntryInfo,
) => LaneValue<T>;

export type LaneInvalidateOptions = {
  onlyIf?: "stale" | "settled";
  staleTime?: number;
};

export type Lane = {
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T>;
  update<T>(key: LaneKey, updater: LaneUpdater<T>): Promise<T> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<T>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
};

export type LaneResult<T> = {
  promise: Promise<T>;
  refreshError: unknown;
  isBackgroundPending: boolean;
  isTransitionPending: boolean;
  invalidate: () => void;
};

/**
 * The shape `useLane` returns when the loader may be absent. Passing
 * `loader: undefined` gates the read off, so `promise` is `undefined` while
 * disabled (nothing is fetched, subscribed, or stored under the key). Unwrap it
 * conditionally — `result.promise ? use(result.promise) : fallback` — which is
 * allowed because `use` may be called inside conditionals.
 */
export type LaneGatedResult<T> = Omit<LaneResult<T>, "promise"> & {
  promise: Promise<T> | undefined;
};

export type LaneRefetchOnMount = boolean | "always";

export type LaneRefetchOnFocus = boolean | "always";

export type LaneRefetchOnReconnect = boolean | "always";

export type LaneUseOptions = {
  staleTime?: number;
  gcTime?: number;
  retry?: number;
  retryDelay?: LaneRetryDelay;
  refetchInterval?: number;
  refetchOnFocus?: LaneRefetchOnFocus;
  refetchOnMount?: LaneRefetchOnMount;
  refetchOnReconnect?: LaneRefetchOnReconnect;
};
