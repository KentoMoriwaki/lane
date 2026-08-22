// Versions, the render count and the artificial delay live for the
// `next start` process, which is exactly the lifetime the scene needs: every
// RSC render of /owner-ask/a must observably advance the values, so a frame
// carrying `k1 v3 (rsc)` names the render that produced it, and the counter
// says how many renders the sequence cost — the whole question an owner-ask
// asks.
//
// On `globalThis` rather than in module scope because a route handler and a
// page are separately bundled: two copies of this module otherwise, and
// `/owner-ask/api` would report a counter no page ever incremented and set a
// delay no page ever read.
type OwnerAskState = {
  versions: Map<string, number>;
  renders: number;
  delayMs: number;
};

export const DEFAULT_DELAY_MS = 600;

const state: OwnerAskState = ((
  globalThis as { __ownerAskState?: OwnerAskState }
).__ownerAskState ??= {
  versions: new Map(),
  renders: 0,
  delayMs: DEFAULT_DELAY_MS,
});

export function nextOwnerValue(name: string): string {
  const version = (state.versions.get(name) ?? 0) + 1;
  state.versions.set(name, version);
  return `${name} v${version} (rsc)`;
}

/** Called once per RSC render of the publishing route. */
export function countServerRender(): number {
  state.renders += 1;
  return state.renders;
}

/** Read without advancing — for the probe route the driver polls. */
export function serverRenderCount(): number {
  return state.renders;
}

/**
 * How long the publishing route's dynamic hole takes, so an ask's round trip
 * is as slow as the first load.
 *
 * Deliberately not a cookie or a search param: reading either is a dynamic API,
 * and under `cacheComponents` a route that reads one renders its dynamic hole
 * **twice per request** — measured against /bfcache/list, which reaches for
 * `connection()` only and renders once. Two renders per request would make
 * every number in this scene's server-render column read double.
 */
export function currentDelay(): number {
  return state.delayMs;
}

export function setDelay(ms: number): number {
  state.delayMs = Number.isFinite(ms) && ms >= 0 && ms <= 10_000 ? ms : DEFAULT_DELAY_MS;
  return state.delayMs;
}
