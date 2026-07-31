import { describe, expect, it } from 'vitest';
import {
  DAILY_CHALLENGE_RULESET_VERSION,
  analyzeMindCascadeSession,
  buildMindCascadeSkillProfile,
  createMindCascadeCoaching,
  getMindCascadeDailyChallenge,
  mindCascadeDailySeed,
  mindCascadeDateKey,
  mindCascadePerformanceFromState,
  recommendMindCascadeDifficulty,
  type MindCascadePerformance,
} from './intelligence';
import { applyMove, createGame, getValidMoves } from './engine';

function performance(
  id: string,
  overrides: Partial<MindCascadePerformance> = {},
): MindCascadePerformance {
  return {
    sessionId: id,
    completedAt: 1_000,
    difficulty: 2,
    moves: 12,
    successfulSwaps: 12,
    invalidSwaps: 0,
    wastedSwaps: 0,
    objectivesCompleted: 4,
    objectiveTarget: 4,
    turnsUsed: 12,
    turnBudget: 18,
    maxCascadeDepth: 5,
    cascadeDepthTotal: 28,
    cascadesResolved: 10,
    hintsUsed: 0,
    forecastsUsed: 0,
    planningTimeMs: 96_000,
    planningSamples: 12,
    completed: true,
    ...overrides,
  };
}

describe('Mind Cascade session evidence', () => {
  it('derives engine-owned signals from deterministic turn history', () => {
    const initial = createGame({ seed: 77, levelId: 'pattern-garden' });
    const state = applyMove(initial, getValidMoves(initial)[0]);
    const derived = mindCascadePerformanceFromState({
      sessionId: 'engine-derived',
      completedAt: 300,
      difficulty: 2,
      state,
      invalidSwaps: 2,
      wastedSwaps: 0,
      hintsUsed: 1,
      forecastsUsed: 1,
      planningTimeMs: 7_500,
      planningSamples: 1,
      completed: true,
    });

    expect(derived.moves).toBe(1);
    expect(derived.successfulSwaps).toBe(1);
    expect(derived.invalidSwaps).toBe(2);
    expect(derived.turnsUsed).toBe(1);
    expect(derived.turnBudget).toBe(state.config.moves);
    expect(derived.objectiveTarget).toBe(state.objectives.length);
    expect(derived.cascadeDepthTotal).toBe(state.history[0].cascades.length);
    expect(derived.completed).toBe(true);
  });

  it('turns every required performance input into inspectable evidence', () => {
    const analysis = analyzeMindCascadeSession(performance('session-evidence', {
      successfulSwaps: 8,
      invalidSwaps: 2,
      wastedSwaps: 1,
      objectivesCompleted: 3,
      objectiveTarget: 4,
      turnsUsed: 14,
      maxCascadeDepth: 4,
      cascadeDepthTotal: 16,
      cascadesResolved: 6,
      hintsUsed: 1,
      forecastsUsed: 2,
      planningTimeMs: 42_000,
      planningSamples: 7,
    }));

    expect(Object.keys(analysis.signals)).toEqual([
      'planning',
      'swap-precision',
      'objective-efficiency',
      'cascade-vision',
      'independent-reasoning',
    ]);
    expect(analysis.signals.planning.evidence).toContain('7 observed decisions');
    expect(analysis.signals['swap-precision'].evidence).toContain(
      '8 productive, 2 invalid, and 1 unproductive',
    );
    expect(analysis.signals['objective-efficiency'].evidence).toContain(
      '3 of 4 objectives',
    );
    expect(analysis.signals['cascade-vision'].evidence).toContain(
      'deepest reached 4',
    );
    expect(analysis.signals['independent-reasoning'].evidence).toContain(
      '1 hints and 2 forecasts',
    );
  });

  it('treats planning rhythm as reflection evidence, not a speed contest', () => {
    const accurateDeliberation = analyzeMindCascadeSession(performance('deliberate', {
      planningTimeMs: 360_000,
      planningSamples: 12,
    }));
    const rushedErrors = analyzeMindCascadeSession(performance('rushed', {
      successfulSwaps: 4,
      invalidSwaps: 5,
      wastedSwaps: 3,
      planningTimeMs: 6_000,
      planningSamples: 12,
    }));

    expect(accurateDeliberation.signals.planning.score).toBeGreaterThan(
      rushedErrors.signals.planning.score,
    );
  });
});

describe('between-session adaptive difficulty', () => {
  it('raises difficulty by only one step after enough strong evidence', () => {
    const recommendation = recommendMindCascadeDifficulty([
      performance('strong-1', { completedAt: 100 }),
      performance('strong-2', { completedAt: 200 }),
      performance('strong-3', { completedAt: 300 }),
    ], 2);

    expect(recommendation.direction).toBe('increase');
    expect(recommendation.recommended).toBe(3);
    expect(recommendation.sessionsAnalyzed).toBe(3);
    expect(recommendation.confidence).toBeGreaterThanOrEqual(35);
    expect(recommendation.explanation).toContain('objective efficiency 35%');
    expect(recommendation.explanation).toContain('never adds a countdown');
  });

  it('suggests one reinforcement step when repeated signals are weak', () => {
    const weak = (id: string, completedAt: number) => performance(id, {
      completedAt,
      successfulSwaps: 2,
      invalidSwaps: 6,
      wastedSwaps: 4,
      objectivesCompleted: 0,
      objectiveTarget: 4,
      maxCascadeDepth: 0,
      cascadeDepthTotal: 0,
      cascadesResolved: 0,
      hintsUsed: 5,
      forecastsUsed: 6,
      planningTimeMs: 4_000,
      planningSamples: 12,
    });
    const recommendation = recommendMindCascadeDifficulty([
      weak('weak-1', 100),
      weak('weak-2', 200),
      weak('weak-3', 300),
    ], 4);

    expect(recommendation.direction).toBe('decrease');
    expect(recommendation.recommended).toBe(3);
    expect(recommendation.score).toBeLessThan(43);
    expect(recommendation.reasons).toHaveLength(3);
  });

  it('does not change difficulty from a single session or outside the bounds', () => {
    expect(recommendMindCascadeDifficulty([performance('only')], 2)).toMatchObject({
      direction: 'maintain',
      recommended: 2,
      sessionsAnalyzed: 1,
    });
    expect(recommendMindCascadeDifficulty([
      performance('top-1'),
      performance('top-2'),
    ], 5)).toMatchObject({ direction: 'maintain', recommended: 5 });
  });

  it('ignores unfinished sessions when adapting between games', () => {
    const recommendation = recommendMindCascadeDifficulty([
      performance('complete'),
      performance('unfinished', { completed: false }),
    ], 2);

    expect(recommendation.sessionsAnalyzed).toBe(1);
    expect(recommendation.direction).toBe('maintain');
  });
});

describe('evidence-grounded coaching', () => {
  it('quotes actual invalid and wasted swaps and gives a concrete experiment', () => {
    const messages = createMindCascadeCoaching(performance('coached', {
      successfulSwaps: 5,
      invalidSwaps: 3,
      wastedSwaps: 2,
    }), 10);
    const precision = messages.find((message) => message.signal === 'swap-precision');

    expect(precision).toMatchObject({
      tone: 'experiment',
      title: 'Verify the first consequence',
    });
    expect(precision?.message).toContain('5 of 10 attempts');
    expect(precision?.evidence).toContain('3 were invalid; 2 were legal');
  });

  it('uses support respectfully and explicitly says planning has no countdown', () => {
    const messages = createMindCascadeCoaching(performance('supported', {
      hintsUsed: 2,
      forecastsUsed: 1,
    }), 10);

    expect(messages.find((message) => message.signal === 'independent-reasoning'))
      .toMatchObject({ title: 'Turn support into a reusable rule' });
    expect(messages.find((message) => message.signal === 'planning')?.evidence)
      .toContain('there is no countdown');
  });

  it('is deterministic and respects the requested message limit', () => {
    const session = performance('deterministic');
    expect(createMindCascadeCoaching(session, 2)).toEqual(
      createMindCascadeCoaching(session, 2),
    );
    expect(createMindCascadeCoaching(session, 2)).toHaveLength(2);
    expect(createMindCascadeCoaching(session, -2)).toHaveLength(0);
  });
});

describe('confidence-labelled skill profile', () => {
  it('reports evidence counts, confidence percentages, and a clear limitation', () => {
    const profile = buildMindCascadeSkillProfile([
      performance('profile-1', { completedAt: 100 }),
      performance('profile-2', { completedAt: 200 }),
    ], 900);
    const planning = profile.skills.find((skill) => skill.id === 'deliberate-planning');

    expect(profile.generatedAt).toBe(900);
    expect(profile.sessionsAnalyzed).toBe(2);
    expect(planning?.evidenceCount).toBe(24);
    expect(planning?.confidence).toBeGreaterThan(0);
    expect(planning?.confidence).toBeLessThanOrEqual(100);
    expect(planning?.evidence).toHaveLength(2);
    expect(profile.strongestSkill).not.toBeNull();
    expect(profile.disclaimer).toContain('not an intelligence');
  });

  it('admits when no skill evidence exists', () => {
    const profile = buildMindCascadeSkillProfile([], 100);

    expect(profile.sessionsAnalyzed).toBe(0);
    expect(profile.strongestSkill).toBeNull();
    expect(profile.growthFocus).toBeNull();
    expect(profile.skills.every((skill) =>
      skill.evidenceCount === 0 && skill.confidence === 0)).toBe(true);
  });
});

describe('deterministic daily challenge', () => {
  it('returns one stable non-zero seed and descriptor for an ISO date', () => {
    const first = getMindCascadeDailyChallenge('2026-07-30');
    const second = getMindCascadeDailyChallenge('2026-07-30');

    expect(first).toEqual(second);
    expect(first.seed).toBe(mindCascadeDailySeed('2026-07-30'));
    expect(first.seed).toBeGreaterThan(0);
    expect(first.id).toContain('2026-07-30');
    expect(first.rulesetVersion).toBe(DAILY_CHALLENGE_RULESET_VERSION);
    expect(first.difficulty).toBeGreaterThanOrEqual(2);
    expect(first.difficulty).toBeLessThanOrEqual(4);
  });

  it('changes with the date and validates real calendar days', () => {
    expect(mindCascadeDailySeed('2026-07-30')).not.toBe(
      mindCascadeDailySeed('2026-07-31'),
    );
    expect(() => mindCascadeDateKey('2026-02-30')).toThrow(/real calendar date/);
    expect(() => mindCascadeDateKey('July 30')).toThrow(/YYYY-MM-DD/);
  });

  it('uses a Date instance local calendar fields', () => {
    const date = new Date(2026, 6, 30, 23, 59);
    expect(mindCascadeDateKey(date)).toBe('2026-07-30');
  });
});
