import { Component, type ReactNode } from 'react';

export interface ErrorBoundaryFallbackProps {
  error: unknown;
  reset: () => void;
}

interface Props {
  children: ReactNode;
  /** Shown instead of the children once a render error is caught. */
  fallback: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode);
  onError?: (error: unknown) => void;
  /** Reset a failed boundary when route/view identity changes. */
  resetKeys?: readonly unknown[];
}
interface State { failed: boolean; error: unknown; }

/**
 * Catches render-time errors in a subtree (e.g. a WebGL/3D board failing on a
 * device without hardware acceleration, or three.js throwing) and shows a
 * fallback instead of letting the whole screen go blank. Scope it tightly
 * around the risky subtree; remounting the boundary (e.g. by toggling the view
 * off and on) resets it.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null };
  static getDerivedStateFromError(error: unknown): State { return { failed: true, error }; }
  componentDidCatch(error: unknown) { this.props.onError?.(error); }
  componentDidUpdate(previous: Props) {
    if (!this.state.failed || !this.props.resetKeys) return;
    const before = previous.resetKeys ?? [];
    const after = this.props.resetKeys;
    if (before.length !== after.length || after.some((key, index) => !Object.is(key, before[index]))) {
      this.reset();
    }
  }
  reset = () => this.setState({ failed: false, error: null });
  render() {
    if (!this.state.failed) return this.props.children;
    return typeof this.props.fallback === 'function'
      ? this.props.fallback({ error: this.state.error, reset: this.reset })
      : this.props.fallback;
  }
}
