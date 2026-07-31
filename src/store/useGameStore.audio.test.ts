import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { playSound, resumeAudio } = vi.hoisted(() => ({
  playSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock('../audio/sound', () => ({
  playSound,
  resumeAudio,
}));

import { useGameStore } from './useGameStore';

describe('shared board-game semantic audio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playSound.mockClear();
    resumeAudio.mockClear();
    useGameStore.setState({
      mode: 'pass',
      humanColor: 0,
      thinking: false,
      autoTutor: false,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('spatializes placements and gives invalid cells a restrained cue', () => {
    useGameStore.getState().newGame('tic-tac-toe');
    playSound.mockClear();

    useGameStore.getState().onCellClick(0);
    expect(playSound).toHaveBeenLastCalledWith('place', expect.objectContaining({
      intensity: 0.48,
      pan: -0.65,
    }));

    playSound.mockClear();
    useGameStore.getState().onCellClick(0);
    expect(playSound).toHaveBeenLastCalledWith('illegal', expect.objectContaining({
      intensity: 0.24,
      pan: -0.65,
    }));
  });

  it('distinguishes selection, movement, and undo', () => {
    useGameStore.getState().newGame('chess');
    playSound.mockClear();

    useGameStore.getState().onCellClick(52);
    expect(playSound).toHaveBeenLastCalledWith('select', expect.objectContaining({ intensity: 0.34 }));

    useGameStore.getState().onCellClick(36);
    expect(playSound).toHaveBeenLastCalledWith('move', expect.objectContaining({ intensity: 0.42 }));

    playSound.mockClear();
    useGameStore.getState().undo();
    expect(playSound).toHaveBeenCalledWith('undo', { intensity: 0.46 });
  });

  it('lets the result cue take over on the winning move', () => {
    useGameStore.getState().newGame('tic-tac-toe');
    playSound.mockClear();

    for (const cell of [0, 3, 1, 4, 2]) useGameStore.getState().onCellClick(cell);

    expect(playSound).toHaveBeenLastCalledWith('win', expect.objectContaining({ intensity: 1 }));
  });
});
