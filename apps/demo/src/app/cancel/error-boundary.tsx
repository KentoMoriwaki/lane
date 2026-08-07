"use client";

import * as React from "react";

/**
 * Where a **first** load failure lands.
 *
 * Lane only rejects a read that has no previous value; once the key has data a
 * failed re-read keeps serving the last good value and rides along as
 * `error` instead. Cancelling follows the same split, which is what makes
 * this boundary worth having here: cancel a refresh and the value stays on
 * screen, cancel a first load and the abort arrives here, because there is
 * nothing else the reader could show.
 *
 * `resetKey` clears a caught error when the query changes, so typing on recovers
 * without a reload.
 */
type Props = {
  children: React.ReactNode;
  resetKey: string;
  fallback: (error: unknown, retry: () => void) => React.ReactNode;
};

type State = { error: unknown };

export class FirstLoadBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error !== null) {
      return this.props.fallback(this.state.error, this.retry);
    }

    return this.props.children;
  }
}
