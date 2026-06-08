"use client";

import * as React from "react";

type LaneErrorBoundaryProps = {
  children: React.ReactNode;
  fallback: (error: unknown, retry: () => void) => React.ReactNode;
  resetKey: string;
};

type LaneErrorBoundaryState = {
  error: unknown;
};

export class LaneErrorBoundary extends React.Component<
  LaneErrorBoundaryProps,
  LaneErrorBoundaryState
> {
  state: LaneErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): LaneErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: LaneErrorBoundaryProps) {
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
