import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../engine/registry';
import { ALL_PUZZLES } from '../puzzles/allPuzzles';
import {
  buildCrossGameRoutes,
  buildTransferRoute,
  conceptPuzzleCount,
  puzzleConceptIds,
} from './crossGameTraining';
import { buildStrategyProfile } from './strategyProfile';

describe('cross-game training routes', () => {
  it('tags authored puzzles and counts only real catalogue positions', () => {
    const fork = ALL_PUZZLES.find((puzzle) => puzzle.theme === 'Fork')!;
    expect(puzzleConceptIds(fork)).toContain('tactics');
    expect(conceptPuzzleCount('chess', 'tactics')).toBeGreaterThan(0);
    expect(conceptPuzzleCount('not-a-game', 'tactics')).toBe(0);
  });

  it('builds a distinct registered route with honest puzzle links', () => {
    const route = buildTransferRoute('connection', { fromGameId: 'hex' });
    expect(route).not.toBeNull();
    expect(route!.sourceGameId).toBe('hex');
    expect(route!.stops.length).toBeGreaterThanOrEqual(2);
    expect(new Set(route!.stops.map((stop) => stop.gameId)).size).toBe(route!.stops.length);
    for (const stop of route!.stops) {
      expect(GAME_MAP[stop.gameId]).toBeTruthy();
      expect(stop.conceptFit).toBeGreaterThan(0);
      expect(stop.puzzleCount).toBe(conceptPuzzleCount(stop.gameId, 'connection'));
      if (stop.href.startsWith('/puzzles')) expect(stop.puzzleCount).toBeGreaterThan(0);
    }
    expect(route!.totalPuzzles).toBe(
      route!.stops.reduce((sum, stop) => sum + stop.puzzleCount, 0),
    );
  });

  it('prioritises profile growth areas and respects the route cap', () => {
    const profile = buildStrategyProfile({
      stats: {
        chess: { played: 5, wins: 0, losses: 5, draws: 0 },
        hex: { played: 3, wins: 2, losses: 1, draws: 0 },
      },
      now: 1,
    });
    const routes = buildCrossGameRoutes(profile, { limit: 3 });
    expect(routes).toHaveLength(3);
    expect(new Set(routes.map((route) => route.conceptId)).size).toBe(routes.length);
    expect(routes.every((route) => route.stops.length >= 2)).toBe(true);
  });
});
