import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { recordResult } = vi.hoisted(() => ({
  recordResult: vi.fn(),
}));

vi.mock('../profile/profile', () => ({
  useProfile: (selector: (profile: { recordResult: typeof recordResult }) => unknown) => (
    selector({ recordResult })
  ),
}));

vi.mock('../audio/sound', () => ({
  playSound: vi.fn(),
  resumeAudio: vi.fn(),
  isMuted: () => false,
  toggleMuted: () => false,
}));

vi.mock('./CoachPanel', () => ({ default: () => null }));
vi.mock('./GameReview', () => ({ default: () => null }));
vi.mock('../engine/reviewSummary', () => ({
  summarize: vi.fn(),
  saveRecord: vi.fn(),
}));

vi.mock('../games/pentago', () => ({
  default: { getStatus: () => ({ kind: 'draw', reason: 'test draw' }) },
}));
vi.mock('../games/pentago/logic', () => ({
  initialState: () => ({ board: Array(36).fill(null), turn: 0 }),
  applyMove: vi.fn(),
  chooseMove: vi.fn(),
  result: () => ({ winner: null, draw: true }),
  moveComment: vi.fn(),
  coachTip: () => '',
  gradeMove: vi.fn(),
}));

vi.mock('../games/quarto', () => ({
  default: { getStatus: () => ({ kind: 'draw', reason: 'test draw' }) },
}));
vi.mock('../games/quarto/logic', () => ({
  initialState: () => ({ board: Array(16).fill(null), held: null, turn: 0 }),
  applyMove: vi.fn(),
  chooseMove: vi.fn(),
  available: () => [],
  winnerOf: () => 'draw',
  attr: () => 0,
  moveComment: vi.fn(),
  coachTip: () => '',
  gradeMove: vi.fn(),
}));

vi.mock('../games/ultimate', () => ({
  default: { getStatus: () => ({ kind: 'draw', reason: 'test draw' }) },
}));
vi.mock('../games/ultimate/logic', () => ({
  initialState: () => ({
    cells: Array(81).fill(null),
    boards: Array(9).fill('draw'),
    turn: 0,
    active: -1,
  }),
  applyMove: vi.fn(),
  chooseMove: vi.fn(),
  winnerOf: () => 'draw',
  playableBoards: () => [],
  moveComment: vi.fn(),
  coachTip: () => '',
  gradeMove: vi.fn(),
}));

vi.mock('../games/surakarta', () => ({
  default: { getStatus: () => ({ kind: 'draw', reason: 'test draw' }) },
}));
vi.mock('../games/surakarta/logic', () => ({
  initialState: () => ({ points: Array(36).fill(null), turn: 0, sinceCapture: 40 }),
  legalMoves: () => [],
  applyMove: vi.fn(),
  winnerOf: () => 'draw',
  chooseMove: vi.fn(),
  gradeMove: vi.fn(),
  moveComment: vi.fn(),
  coachTip: () => '',
  rowOf: (index: number) => Math.floor(index / 6),
  colOf: (index: number) => index % 6,
  SIZE: 6,
}));

import PentagoGame from './PentagoGame';
import QuartoGame from './QuartoGame';
import UltimateGame from './UltimateGame';
import SurakartaGame from './SurakartaGame';

const CASES: Array<[string, ComponentType, string]> = [
  ['Pentago', PentagoGame, 'pentago'],
  ['Quarto', QuartoGame, 'quarto'],
  ['Ultimate Tic-Tac-Toe', UltimateGame, 'ultimate'],
  ['Surakarta', SurakartaGame, 'surakarta'],
];

describe.each(CASES)('%s draw completion', (_name, Game, gameId) => {
  beforeEach(() => recordResult.mockClear());
  afterEach(cleanup);

  it('records one draw through the shared profile pipeline', async () => {
    render(
      <MemoryRouter>
        <Game />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(recordResult).toHaveBeenCalledTimes(1);
      expect(recordResult).toHaveBeenCalledWith(gameId, 'draw', 'medium');
    });
  });
});
