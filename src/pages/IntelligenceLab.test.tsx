import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import IntelligenceLab from './IntelligenceLab';
import { getGame } from '../engine/registry';
import { LAB_STORAGE_KEY } from '../intelligence/labStore';

function savedTicTacToeReview() {
  const def = getGame('tic-tac-toe')!;
  const initial = def.createInitialState();
  const move = def.getLegalMoves(initial, null)[0];
  const after = def.applyMove(initial, move);
  return {
    id: 'review-tic',
    ts: 1_700_000_000_000,
    gameId: def.id,
    gameName: def.name,
    emoji: def.emoji,
    accent: def.accent,
    result: 'draw',
    winner: null,
    reason: 'test',
    p0: def.players[0].name,
    p1: def.players[1].name,
    acc: [72, 70],
    graded: [1, 0],
    moves: 1,
    evalPts: [0.1],
    key: [],
    humanColor: 0,
    concepts: [{
      id: 'space-control',
      label: 'Space control',
      attempts: 1,
      strong: 1,
      needsWork: 0,
      moves: [1],
    }],
    replay: {
      version: 1,
      totalPlies: 1,
      sampled: false,
      frames: [
        { ply: 0, player: null, notation: 'Initial position', state: def.serialize(initial) },
        {
          ply: 1,
          player: 0,
          notation: move.notation,
          state: def.serialize(after),
          band: 'good',
          summary: 'The move claims an important line.',
          principles: ['Take the center first: it belongs to four lines.'],
          betterIdea: 'Compare the centre and corners before committing.',
        },
      ],
    },
  };
}

describe('IntelligenceLab', () => {
  beforeEach(() => localStorage.clear());

  it('shows truthful empty evidence and switches between all four functional tabs', () => {
    render(<MemoryRouter><IntelligenceLab /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /first replay begins/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /strategy dna/i }));
    expect(screen.getByRole('heading', { name: /measured profile/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cross-game training/i }));
    expect(screen.getByRole('heading', { name: /transfer routes need/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /explainable coach/i }));
    expect(screen.getByRole('heading', { name: /coach needs a real decision/i })).toBeInTheDocument();
  });

  it('scrubs real saved positions and persists annotations and generated drills', () => {
    localStorage.setItem('gm-reviews', JSON.stringify([savedTicTacToeReview()]));
    render(<MemoryRouter><IntelligenceLab /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /next replay position/i }));
    expect(screen.getByText(/ply 1/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /your annotation/i }), {
      target: { value: 'I should compare the centre before choosing a corner.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate drill/i }));

    const stored = JSON.parse(localStorage.getItem(LAB_STORAGE_KEY) || '{}');
    expect(stored.annotations).toHaveLength(1);
    expect(stored.annotations[0]).toMatchObject({ reviewId: 'review-tic', frameIndex: 1 });
    expect(stored.generatedDrills).toHaveLength(1);
    expect(stored.generatedDrills[0]).toMatchObject({ gameId: 'tic-tac-toe', source: 'replay' });
  });
});
