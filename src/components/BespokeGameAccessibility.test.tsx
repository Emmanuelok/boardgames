import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { playSound, resumeAudio } = vi.hoisted(() => ({
  playSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock('../audio/sound', () => ({
  playSound,
  resumeAudio,
  isMuted: () => false,
  toggleMuted: () => false,
}));
vi.mock('../profile/profile', () => ({
  useProfile: (selector: (state: { recordResult: () => void }) => unknown) => selector({ recordResult: () => {} }),
}));
vi.mock('./CoachPanel', () => ({ default: () => null }));
vi.mock('./GameReview', () => ({ default: () => null }));
vi.mock('../engine/reviewSummary', () => ({ summarize: vi.fn(), saveRecord: vi.fn() }));

import DotsAndBoxesGame from './DotsAndBoxesGame';
import PentagoGame from './PentagoGame';
import QuartoGame from './QuartoGame';
import SurakartaGame from './SurakartaGame';

const show = (game: React.ReactNode) => render(<MemoryRouter>{game}</MemoryRouter>);

describe('bespoke game board accessibility', () => {
  afterEach(() => {
    cleanup();
    playSound.mockClear();
    resumeAudio.mockClear();
  });

  it('uniquely identifies horizontal and vertical Dots & Boxes edges', () => {
    show(<DotsAndBoxesGame />);

    expect(screen.getByRole('button', {
      name: 'Horizontal edge, dot row 1, columns 1 to 2: draw this line',
    })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', {
      name: 'Vertical edge, dot column 1, rows 1 to 2: draw this line',
    })).toHaveAttribute('aria-disabled', 'false');
  });

  it('gives Pentago and Quarto cells board coordinates and state', () => {
    const pentago = show(<PentagoGame />);
    expect(screen.getByRole('button', { name: 'a6, empty; place an Amber marble' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'f1, empty; place an Amber marble' })).toBeInTheDocument();
    pentago.unmount();

    show(<QuartoGame />);
    expect(screen.getByRole('button', { name: 'a4, empty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd1, empty' })).toBeInTheDocument();
  });

  it('lets keyboard players select a labelled Surakarta piece', () => {
    show(<SurakartaGame />);
    const piece = screen.getByRole('button', { name: 'a2, your gold piece; select this piece' });

    expect(piece).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(piece, { key: 'Enter' });

    expect(screen.getByRole('button', { name: 'a2, your gold piece, selected' })).toHaveAttribute('aria-pressed', 'true');
    expect(playSound).toHaveBeenCalledWith('select', expect.objectContaining({ intensity: 0.32 }));
  });
});
