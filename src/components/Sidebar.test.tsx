import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useProgression } from '../progression/progression';

describe('<Sidebar>', () => {
  beforeEach(() => { localStorage.clear(); useProgression.getState().reset(); });

  it('renders the grouped nav and the live progression widget', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    // Decluttered, grouped navigation is present.
    for (const label of ['Games', 'Daily', 'Openings', 'Puzzles', 'Reviews', 'Shop', 'Profile']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Fresh profile starts at level 1.
    expect(screen.getByText('Lv 1')).toBeInTheDocument();
  });

  it('reflects earned XP/coins in the widget', () => {
    useProgression.getState().recordGame({ gameId: 'chess', result: 'win', difficulty: 'easy' });
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    // 50 (win) + 40 (discovery) = 90 XP ≥ 80 needed for L2 → level 2.
    expect(screen.getByText('Lv 2')).toBeInTheDocument();
    // coins: 20 (win) + 25 (discovery) + 25 (level-up) = 70.
    expect(screen.getByText('🪙 70')).toBeInTheDocument();
  });
});
