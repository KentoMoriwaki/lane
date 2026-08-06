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
};

export const DEFAULT_SETTINGS: CancelLabSettings = {
  latencyMs: 1200,
  cancelSuperseded: false,
  forwardSignal: true,
};
