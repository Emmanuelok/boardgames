import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { playSound } = vi.hoisted(() => ({ playSound: vi.fn() }));

vi.mock('../audio/sound', () => ({ playSound }));
vi.mock('./InteractiveLesson', () => ({
  default: ({ onSolved, onFailed }: { onSolved: () => void; onFailed: () => void }) => (
    <div>
      <button type="button" onClick={onSolved}>Simulate solved</button>
      <button type="button" onClick={onFailed}>Simulate failed</button>
    </div>
  ),
}));

import OpeningGauntlet from './OpeningGauntlet';
import OpeningTrainer from './OpeningTrainer';

const theme = {} as any;

describe('opening training delayed transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playSound.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('cancels a Gauntlet advance when the experience unmounts', () => {
    const { unmount } = render(<OpeningGauntlet theme={theme} onExit={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Simulate solved' }));
    expect(playSound).toHaveBeenCalledWith('objective', expect.any(Object));

    unmount();
    act(() => vi.runAllTimers());

    expect(playSound.mock.calls.some(([name]) => name === 'complete')).toBe(false);
  });

  it('invalidates the Trainer callback when the learner changes sides', () => {
    render(
      <OpeningTrainer
        opening={{ eco: 'T00', name: 'Timer test line', moves: ['e4', 'e5'] }}
        theme={theme}
        onExit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Simulate solved' }));
    fireEvent.click(screen.getByRole('button', { name: /Black/ }));
    act(() => vi.runAllTimers());

    expect(playSound.mock.calls.some(([name]) => name === 'complete')).toBe(false);
    expect(screen.getByText(/0\/1/)).toBeInTheDocument();
  });
});
