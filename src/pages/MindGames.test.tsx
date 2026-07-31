import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MIND_CASCADE_PROGRESS_STORAGE_KEY,
  createEmptyMindCascadeProgress,
} from '../mindgames/progress';
import type { MindCascadePerformance } from '../mindgames/intelligence';
import MindGames from './MindGames';

function measuredSession(): MindCascadePerformance {
  return {
    sessionId: 'hub-evidence',
    completedAt: 1_000,
    difficulty: 2,
    moves: 12,
    successfulSwaps: 10,
    invalidSwaps: 1,
    wastedSwaps: 1,
    objectivesCompleted: 3,
    objectiveTarget: 3,
    turnsUsed: 12,
    turnBudget: 18,
    maxCascadeDepth: 4,
    cascadeDepthTotal: 18,
    cascadesResolved: 8,
    hintsUsed: 1,
    forecastsUsed: 1,
    planningTimeMs: 96_000,
    planningSamples: 12,
    completed: true,
  };
}

describe('<MindGames>', () => {
  beforeEach(() => localStorage.clear());

  it('presents the complete flagship game and deterministic daily challenge', () => {
    render(<MemoryRouter><MindGames /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Mind Cascade' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Play Mind Cascade/i })).toHaveAttribute('href', '/mind-games/cascade');
    expect(screen.getByRole('link', { name: /today’s deterministic seed/i })).toHaveAttribute('href', '/mind-games/cascade?daily=1');
    expect(screen.getByText(/No pressure timer, purchasable lives, loot boxes or randomized rewards/i)).toBeInTheDocument();
    expect(screen.getByText(/Same date · same position · fully reproducible/i)).toBeInTheDocument();
  });

  it('labels future concepts honestly and leaves an empty profile unmeasured', () => {
    render(<MemoryRouter><MindGames /></MemoryRouter>);

    expect(screen.getAllByText('Concept under development')).toHaveLength(3);
    expect(screen.getAllByText('Unmeasured')).toHaveLength(5);
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
    screen.getAllByRole('progressbar').forEach((progress) => {
      expect(progress).not.toHaveAttribute('value');
      expect(progress).toHaveAccessibleName(/unmeasured/i);
    });
    expect(screen.getAllByText(/No score yet/i)).toHaveLength(5);
    expect(screen.getByText(/describes only evidence observed here/i)).toBeInTheDocument();
    expect(screen.getByText(/not an intelligence, aptitude, or clinical assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Local strategy evidence/i)).toBeInTheDocument();
    expect(screen.queryByText(/Local intelligence record/i)).not.toBeInTheDocument();
  });

  it('renders persisted play evidence with a score, evidence count, and confidence', () => {
    localStorage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...createEmptyMindCascadeProgress(1_000),
      performanceHistory: [measuredSession()],
      totalCompletedSessions: 1,
    }));

    render(<MemoryRouter><MindGames /></MemoryRouter>);

    const planning = screen.getByRole('progressbar', {
      name: /Planning rhythm: \d+ out of 100/i,
    });
    expect(planning).toHaveAttribute('value');
    expect(planning).toHaveAttribute('aria-describedby', 'mind-games-deliberate-planning-evidence');
    expect(screen.getByText(
      /12 recorded observations · \d+% confidence/i,
      { selector: '#mind-games-deliberate-planning-evidence' },
    )).toBeInTheDocument();
    expect(screen.queryByText('Unmeasured')).not.toBeInTheDocument();
  });

  it('offers an explicit resume route only when a valid local board exists', () => {
    localStorage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...createEmptyMindCascadeProgress(1_500),
      resumableSession: {
        id: 'saved-board',
        mode: 'classic',
        engineVersion: '1',
        seed: 84,
        difficulty: 2,
        startedAt: 1_000,
        savedAt: 1_500,
        moveNumber: 2,
        score: 120,
        state: { board: [], movesRemaining: 20 },
        steps: [],
      },
    }));

    render(<MemoryRouter><MindGames /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Resume saved board' }))
      .toHaveAttribute('href', '/mind-games/cascade?resume=1');
  });
});
