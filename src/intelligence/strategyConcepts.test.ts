import { describe, expect, it } from 'vitest';
import { GAMES } from '../engine/registry';
import {
  affinitiesForGame,
  classifyPrinciples,
  conceptIdsForPrinciples,
  GAME_CONCEPT_AFFINITIES,
  isStrategyConceptId,
} from './strategyConcepts';

describe('strategy concept vocabulary', () => {
  it('classifies authored natural-language principles into stable, deduplicated ids', () => {
    const ids = conceptIdsForPrinciples([
      'Build a double threat: two ways to win, only one defender.',
      'Fight for the centre and keep your pieces connected.',
      'Build a double threat again.',
    ]);
    expect(ids).toContain('tactics');
    expect(ids).toContain('space-control');
    expect(ids).toContain('connection');
    expect(new Set(ids).size).toBe(ids.length);
    expect(classifyPrinciples(['Corners are valuable squares.']).map((item) => item.id))
      .toContain('space-control');
  });

  it('has a valid authored fingerprint for every registered game and no stale games', () => {
    const registered = new Set(GAMES.map((game) => game.id));
    expect(Object.keys(GAME_CONCEPT_AFFINITIES).sort()).toEqual([...registered].sort());
    for (const game of GAMES) {
      const affinities = affinitiesForGame(game.id);
      expect(affinities.length, game.id).toBeGreaterThanOrEqual(4);
      expect(new Set(affinities.map((item) => item.conceptId)).size, game.id).toBe(affinities.length);
      expect(affinities.some((item) => item.role === 'primary'), game.id).toBe(true);
      for (const item of affinities) {
        expect(isStrategyConceptId(item.conceptId), `${game.id}:${item.conceptId}`).toBe(true);
        expect(item.weight).toBeGreaterThan(0);
        expect(item.weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
