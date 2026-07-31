import { describe, expect, it } from 'vitest';
import type { GameRecord } from '../engine/reviewSummary';
import { buildStrategyProfile, strategyDimension, type StrategyGameRecord } from './strategyProfile';

const baseReview: GameRecord = {
  id: 'review-1',
  ts: 1_700_000_000_000,
  gameId: 'chess',
  gameName: 'Chess',
  emoji: '♟',
  accent: '#7c3aed',
  result: 'win',
  winner: 0,
  reason: 'checkmate',
  p0: 'White',
  p1: 'Black',
  acc: [80, 70],
  graded: [5, 4],
  moves: 9,
  evalPts: [0, .3, 1],
  key: [],
};

describe('Strategy DNA aggregation', () => {
  it('reports exact source counts while calibrating scores and confidence', () => {
    const review: StrategyGameRecord = {
      ...baseReview,
      humanColor: 0,
      concepts: [{
        id: 'tactics',
        label: 'Tactical vision',
        attempts: 5,
        strong: 3,
        needsWork: 1,
        moves: [1, 2, 3, 4, 5],
      }],
    };
    const profile = buildStrategyProfile({
      reviews: [review],
      profile: {
        rating: 912,
        stats: { chess: { played: 4, wins: 2, losses: 1, draws: 1 } },
      },
      puzzleEvidence: [{
        id: 'attempt-1',
        gameId: 'chess',
        conceptIds: ['tactics'],
        solved: true,
        attempts: 2,
      }],
      now: 123,
    });
    const tactics = strategyDimension(profile, 'tactics');
    expect(tactics.evidenceCount).toBe(11);
    expect(tactics.sources).toEqual({ moves: 5, matches: 4, puzzles: 2, reviews: 1 });
    expect(tactics.strongCount).toBe(4);
    expect(tactics.needsWorkCount).toBe(1);
    expect(tactics.score).toBeGreaterThan(50);
    expect(tactics.confidence).toBeGreaterThan(0);
    expect(profile.rating).toBe(912);
    expect(profile.generatedAt).toBe(123);
    expect(profile.dataQuality).toMatchObject({
      directConceptReviews: 1,
      attributedReviewMoves: 0,
      matches: 4,
      puzzles: 2,
    });
  });

  it('uses only the known human side for legacy move attribution', () => {
    const profile = buildStrategyProfile({
      reviews: [{ ...baseReview, humanColor: 1, concepts: undefined }],
      now: 1,
    });
    expect(strategyDimension(profile, 'tactics').sources.moves).toBe(4);
    expect(profile.dataQuality.attributedReviewMoves).toBe(4);
    expect(profile.dataQuality.legacyReviews).toBe(0);
  });

  it('does not invent player performance from legacy two-sided accuracy', () => {
    const profile = buildStrategyProfile({ reviews: [baseReview], now: 1 });
    expect(profile.totalEvidence).toBe(0);
    expect(profile.measuredConcepts).toBe(0);
    expect(profile.dataQuality.legacyReviews).toBe(1);
    expect(profile.strengths).toEqual([]);
    expect(profile.growthAreas).toEqual([]);
    expect(profile.dimensions.every((dimension) =>
      dimension.score === 50 && dimension.confidence === 0 && dimension.state === 'unmeasured',
    )).toBe(true);
  });
});
