"use client";

import * as React from "react";

type QueryErrorBoundaryProps = {
  children: React.ReactNode;
  fallback: (error: unknown, retry: () => void) => React.ReactNode;
  resetKey: string;
};

type QueryErrorBoundaryState = {
  error: unknown;
};

export class QueryErrorBoundary extends React.Component<
  QueryErrorBoundaryProps,
  QueryErrorBoundaryState
> {
  state: QueryErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): QueryErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: QueryErrorBoundaryProps) {
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
