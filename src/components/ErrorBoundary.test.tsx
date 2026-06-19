import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

const Boom = (): null => { throw new Error('boom'); };

describe('<ErrorBoundary>', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary fallback={<div>fallback</div>}><div>healthy child</div></ErrorBoundary>);
    expect(screen.getByText('healthy child')).toBeInTheDocument();
  });

  it('renders the fallback (and reports) when a child throws', () => {
    const onError = vi.fn();
    // React logs the caught error to console.error; silence it for a clean run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary fallback={<div>3D board unavailable</div>} onError={onError}><Boom /></ErrorBoundary>);
    expect(screen.getByText('3D board unavailable')).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
    spy.mockRestore();
  });
});
