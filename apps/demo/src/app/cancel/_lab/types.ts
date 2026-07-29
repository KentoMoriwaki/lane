/**
 * Lab-level settings: what the server is told to do, and how the page is driven.
 *
 * Nothing here describes how the read is keyed or rendered — `_lab/` owns the
 * measurement apparatus (the instrumented fetch, the request log, the timeline)
 * and the page owns the reading.
 */
export type CancelLabSettings = {
  /**
   * Per-request, and deliberately long by default. The whole question is what
   * happens to a read that is still in flight when the key moves on, so the
   * request has to outlive the keystroke that started it.
   */
  latencyMs: number;
  /**
   * Whether the field cancels the key it is moving away from, at the moment it
   * moves. Off is the current behaviour: superseded reads run to completion.
   */
  cancelSuperseded: boolean;
  /**
   * Whether the loader forwards its `signal` to `fetch`.
   *
   * Turning it off models the loader every codebase eventually writes by
   * accident. It is a control rather than a mistake to be avoided because the
   * answer is a property of the library: a cancel that only works when the
   * loader cooperates is a different feature from one that always holds.
   */
  forwardSignal: boolean;
  /**
   * The read's own `whenStale`.
   *
   * It is a lab control because it decides what a *rejected* cache is worth:
   * `"revalidate"` reuses one, `"refetch"` discards it on an idle read. A
   * cancelled first load settles rejected and is read again immediately — by the
   * retry of the render that was never committed — so this is not a detail about
   * staleness here, it is what happens next.
   */
  whenStale: "revalidate" | "refetch";
};

export const DEFAULT_SETTINGS: CancelLabSettings = {
  latencyMs: 1200,
  cancelSuperseded: false,
  forwardSignal: true,
  whenStale: "revalidate",
};
