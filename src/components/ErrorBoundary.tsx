import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown instead of the children once a render error is caught. */
  fallback: ReactNode;
  onError?: (error: unknown) => void;
}
interface State { failed: boolean; }

/**
 * Catches render-time errors in a subtree (e.g. a WebGL/3D board failing on a
 * device without hardware acceleration, or three.js throwing) and shows a
 * fallback instead of letting the whole screen go blank. Scope it tightly
 * around the risky subtree; remounting the boundary (e.g. by toggling the view
 * off and on) resets it.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError?.(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
