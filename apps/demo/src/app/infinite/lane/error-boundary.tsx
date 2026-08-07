"use client";

import * as React from "react";

/**
 * Where an **initial** load failure lands.
 *
 * Lane only rejects a read that has no previous value; once the key has data, a
 * failed re-read keeps serving the last good value and rides along as
 * `error` instead (rendered inline in the list, never thrown). So this
 * boundary is reached exactly once per key: the first page failing before there
 * is anything to show.
 *
 * `resetKey` clears a caught error when the feed parameters change, so picking a
 * different sort recovers without a reload.
 */
type Props = {
  children: React.ReactNode;
  resetKey: string;
  fallback: (error: unknown, retry: () => void) => React.ReactNode;
};

type State = { error: unknown };

export class InitialLoadBoundary extends React.Component<Props, State> {
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
