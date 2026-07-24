import { describe, expect, it } from 'vitest';
import { CATALOGUE, GAMES } from './registry';
import { CATALOGUE_WORLD_COUNT, GAME_COUNT } from './catalogueMeta';

describe('catalogue metadata', () => {
  it('stays synchronized with the playable registry', () => {
    expect(GAMES).toHaveLength(GAME_COUNT);
    expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAME_COUNT);
  });

  it('stays synchronized with the family-collapsed discovery catalogue', () => {
    expect(CATALOGUE).toHaveLength(CATALOGUE_WORLD_COUNT);
  });
});
