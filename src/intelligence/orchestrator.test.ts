import { describe, expect, it } from 'vitest';
import type { GameRecord } from '../engine/reviewSummary';
import type { Tally } from '../profile/profile';
import { buildLearningMission, type GameSignal, type LearnerSnapshot } from './orchestrator';

const games: GameSignal[] = [
  { id: 'go', name: 'Go', emoji: '⚫', category: 'Abstract', depth: 5 },
  { id: 'chess', name: 'Chess', emoji: '♟', category: 'Strategy', depth: 5 },
  { id: 'hex', name: 'Hex', emoji: '⬡', category: 'Abstract', depth: 4 },
];

const tally = (played: number, wins: number, losses = played - wins, draws = 0): Tally => ({
  played, wins, losses, draws,
});

function snapshot(overrides: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  return {
    name: 'You',
    rating: 800,
    stats: {},
    totalPlayed: 0,
    totalWins: 0,
    xp: 0,
    seenGames: [],
    gamesToday: [],
    dailyStreak: 0,
    puzzlesSolved: 0,
    puzzleStreak: 0,
    reviews: [],
    ...overrides,
  };
}

function review(gameId: string): GameRecord {
  return {
    id: 'review-1',
    ts: 1,
    gameId,
    gameName: gameId,
    emoji: '◇',
    accent: '#fff',
    result: 'loss',
    winner: 1,
    reason: 'complete',
    p0: 'First',
    p1: 'Second',
    acc: [72, 89],
    moves: 18,
    evalPts: [0, -0.2],
    key: [{ n: 7, notation: 'm7', band: 'mistake', player: 0 }],
  };
}

describe('adaptive learning orchestrator', () => {
  it('builds a complete baseline route around chess for a new learner', () => {
    const mission = buildLearningMission(snapshot(), games);

    expect(mission.focus.id).toBe('chess');
    expect(mission.difficulty).toBe('Easy');
    expect(mission.steps.map((step) => step.id)).toEqual(['observe', 'learn', 'practice', 'play', 'reflect']);
    expect(mission.steps[0]).toMatchObject({ state: 'recommended', to: '/play/chess?difficulty=easy' });
    expect(mission.agents).toHaveLength(5);
    expect(mission.duration).toBeGreaterThan(0);
    expect(mission.confidence).toBeGreaterThanOrEqual(48);
  });

  it('prioritizes recent weak evidence and connects review, lesson, practice and play', () => {
    const mission = buildLearningMission(snapshot({
      name: 'Ada',
      rating: 1320,
      stats: { chess: tally(8, 6), hex: tally(6, 1) },
      totalPlayed: 14,
      totalWins: 7,
      seenGames: ['chess', 'hex'],
      gamesToday: ['chess'],
      puzzlesSolved: 12,
      puzzleStreak: 3,
      reviews: [review('hex')],
    }), games);

    expect(mission.focus.id).toBe('hex');
    expect(mission.headline).toContain('Ada');
    expect(mission.difficulty).toBe('Hard');
    expect(mission.steps[0]).toMatchObject({ to: '/reviews', title: 'Revisit one key moment' });
    expect(mission.steps.find((step) => step.id === 'practice')).toMatchObject({ to: '/puzzles?game=hex', state: 'ready' });
    expect(mission.concepts.every((concept) => concept.score >= 0 && concept.score <= 100)).toBe(true);
  });

  it('keeps an in-progress mission pinned to its exact focus game', () => {
    const mission = buildLearningMission(snapshot({
      stats: { chess: tally(9, 1), hex: tally(2, 2) },
    }), games, 'hex');

    expect(mission.focus.id).toBe('hex');
  });

  it('uses a coached match when a game has no authored puzzle pack', () => {
    const withoutPuzzle = games.map((game) => (
      game.id === 'hex' ? { ...game, practiceAvailable: false } : game
    ));
    const mission = buildLearningMission(snapshot(), withoutPuzzle, 'hex');

    expect(mission.steps.find((step) => step.id === 'practice')).toMatchObject({
      to: '/play/hex?difficulty=easy',
      title: 'Rehearse in a coached game',
    });
  });

  it.each([
    [599, 'Tutor'],
    [600, 'Easy'],
    [900, 'Medium'],
    [1250, 'Hard'],
    [1600, 'Master'],
  ] as const)('maps a %i rating to %s sparring strength', (rating, expected) => {
    expect(buildLearningMission(snapshot({ rating }), games).difficulty).toBe(expected);
  });

  it('rejects an empty game catalogue with an actionable error', () => {
    expect(() => buildLearningMission(snapshot(), [])).toThrow('At least one game is required');
  });
});
