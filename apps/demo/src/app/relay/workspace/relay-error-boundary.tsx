"use client";

import * as React from "react";

type RelayErrorBoundaryProps = {
  children: React.ReactNode;
  fallback: (error: unknown, retry: () => void) => React.ReactNode;
  resetKey: string;
};

type RelayErrorBoundaryState = {
  error: unknown;
};

/**
 * A small error boundary that pairs with Relay's Suspense reads: a failed query
 * throws to the nearest boundary, and changing `resetKey` (or the retry
 * callback) clears it so the boundary re-renders and Relay re-fetches.
 */
export class RelayErrorBoundary extends React.Component<
  RelayErrorBoundaryProps,
  RelayErrorBoundaryState
> {
  state: RelayErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): RelayErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: RelayErrorBoundaryProps) {
    if (
      this.state.error !== null &&
      previousProps.resetKey !== this.props.resetKey
    ) {
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
