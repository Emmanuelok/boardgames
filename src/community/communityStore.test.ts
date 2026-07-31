import { describe, expect, it } from 'vitest';
import { createRoundRobin, reportMatch } from './brackets';
import { normalizeCommunityData } from './communityStore';

describe('community tournament persistence', () => {
  it('preserves completed round-robin draws through the storage boundary', () => {
    let bracket = createRoundRobin(['North', 'East', 'West']);
    const drawnMatch = bracket.rounds[0][0];
    bracket = reportMatch(bracket, drawnMatch.id, null);

    const data = normalizeCommunityData({
      version: 1,
      clubs: [],
      tournaments: [{
        id: 'tournament-draw-test',
        name: 'Friendly Table',
        gameId: 'chess',
        format: 'round-robin',
        createdAt: 10,
        status: 'active',
        bracket,
        fixedRecognition: 'Community Champion badge',
      }],
    });

    expect(data.tournaments[0].bracket.rounds[0][0]).toMatchObject({
      id: drawnMatch.id,
      status: 'complete',
      winnerId: null,
      scoreA: 1,
      scoreB: 1,
    });
  });
});
