import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('can retry a failed subtree without reloading the application', () => {
    let shouldThrow = true;
    const MaybeBoom = () => {
      if (shouldThrow) throw new Error('temporary');
      return <div>recovered child</div>;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={({ reset }) => (
        <button onClick={() => { shouldThrow = false; reset(); }}>Try again</button>
      )}>
        <MaybeBoom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered child')).toBeInTheDocument();
    spy.mockRestore();
  });
});
