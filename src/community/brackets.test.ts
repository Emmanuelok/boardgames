import { describe, expect, it } from 'vitest';
import { bracketChampion, createKnockout, createRoundRobin, reportMatch } from './brackets';

describe('community brackets', () => {
  it('seeds and advances a four-player knockout deterministically', () => {
    let bracket = createKnockout(['A', 'B', 'C', 'D']);
    expect(bracket.rounds[0].map((match) => [match.playerA?.name, match.playerB?.name])).toEqual([
      ['A', 'D'],
      ['B', 'C'],
    ]);
    bracket = reportMatch(bracket, 'r1m1', 'p1');
    bracket = reportMatch(bracket, 'r1m2', 'p2');
    expect(bracket.rounds[1][0].status).toBe('ready');
    bracket = reportMatch(bracket, 'r2m1', 'p1');
    expect(bracketChampion(bracket)?.name).toBe('A');
  });

  it('creates every round-robin pairing exactly once', () => {
    const bracket = createRoundRobin(['A', 'B', 'C', 'D']);
    const pairings = bracket.rounds.flat().map((match) => [match.playerA?.id, match.playerB?.id].sort().join('-'));
    expect(pairings).toHaveLength(6);
    expect(new Set(pairings).size).toBe(6);
  });

  it('records transparent round-robin draws without inventing a winner', () => {
    let bracket = createRoundRobin(['A', 'B', 'C']);
    const match = bracket.rounds[0][0];
    bracket = reportMatch(bracket, match.id, null);
    expect(bracket.rounds[0][0]).toMatchObject({
      status: 'complete',
      winnerId: null,
      scoreA: 1,
      scoreB: 1,
    });
  });

  it('keeps knockout matches winner-only and makes default scores match the winner', () => {
    const untouched = createKnockout(['A', 'B', 'C', 'D']);
    expect(reportMatch(untouched, 'r1m1', null)).toBe(untouched);

    const wonByB = reportMatch(untouched, 'r1m1', 'p4');
    expect(wonByB.rounds[0][0]).toMatchObject({
      winnerId: 'p4',
      scoreA: 0,
      scoreB: 1,
    });
  });

  it('rejects a score that contradicts the selected result', () => {
    const bracket = createRoundRobin(['A', 'B', 'C']);
    const match = bracket.rounds[0][0];
    expect(reportMatch(bracket, match.id, null, [2, 1])).toBe(bracket);
    expect(reportMatch(bracket, match.id, match.playerA!.id, [0, 1])).toBe(bracket);
  });

  it('rejects unsupported knockout sizes', () => {
    expect(() => createKnockout(['A', 'B', 'C'])).toThrow(/4 or 8/);
  });
});
