import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_MIND_CASCADE_REPLAYS,
  MIND_CASCADE_ACHIEVEMENTS,
  MIND_CASCADE_PROGRESS_STORAGE_KEY,
  MIND_CASCADE_PROGRESS_VERSION,
  completeMindCascadeSession,
  createEmptyMindCascadeProgress,
  createMindCascadeProgressRepository,
  createResumableMindCascadeSession,
  evaluateMindCascadeAchievements,
  loadMindCascadeProgress,
  loadMindCascadeProgressResult,
  normalizeMindCascadeProgress,
  parseMindCascadeProgress,
  saveMindCascadeProgress,
  withResumableMindCascadeSession,
  withoutResumableMindCascadeSession,
  type MindCascadeProgressStorage,
  type MindCascadeReplay,
  type ResumableMindCascadeSession,
} from './progress';
import type { MindCascadePerformance } from './intelligence';
import { applyMove, createGame, getValidMoves } from './engine';

function performance(
  id: string,
  overrides: Partial<MindCascadePerformance> = {},
): MindCascadePerformance {
  return {
    sessionId: id,
    completedAt: 2_000,
    difficulty: 3,
    moves: 12,
    successfulSwaps: 10,
    invalidSwaps: 1,
    wastedSwaps: 1,
    objectivesCompleted: 3,
    objectiveTarget: 3,
    turnsUsed: 12,
    turnBudget: 16,
    maxCascadeDepth: 4,
    cascadeDepthTotal: 18,
    cascadesResolved: 8,
    hintsUsed: 1,
    forecastsUsed: 0,
    planningTimeMs: 84_000,
    planningSamples: 12,
    completed: true,
    ...overrides,
  };
}

function resume(
  id = 'session-1',
  overrides: Partial<ResumableMindCascadeSession> = {},
): ResumableMindCascadeSession {
  return {
    id,
    mode: 'classic',
    engineVersion: '1',
    seed: 42,
    difficulty: 3,
    startedAt: 1_000,
    savedAt: 1_500,
    moveNumber: 2,
    score: 140,
    state: {
      board: [['focus', 'logic'], ['pattern', 'focus']],
      movesRemaining: 14,
      rngState: 912,
    },
    steps: [{
      turn: 1,
      action: { from: [0, 0], to: [0, 1] },
      scoreDelta: 70,
      objectiveDelta: 1,
      cascadeDepth: 2,
      boardHash: 'board-1',
    }],
    ...overrides,
  };
}

function replay(
  id = 'replay-1',
  sessionId = 'session-1',
  overrides: Partial<MindCascadeReplay> = {},
): MindCascadeReplay {
  const sessionPerformance = performance(sessionId);
  return {
    id,
    sessionId,
    title: 'Designed path',
    mode: 'classic',
    engineVersion: '1',
    seed: 42,
    difficulty: 3,
    startedAt: 1_000,
    completedAt: sessionPerformance.completedAt,
    outcome: 'objective-complete',
    score: 840,
    steps: resume(sessionId).steps,
    performance: sessionPerformance,
    ...overrides,
  };
}

describe('versioned Mind Cascade progress', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with a stable, private local progress shape', () => {
    expect(createEmptyMindCascadeProgress(100)).toEqual({
      version: MIND_CASCADE_PROGRESS_VERSION,
      updatedAt: 100,
      selectedDifficulty: 2,
      resumableSession: null,
      replays: [],
      performanceHistory: [],
      achievements: [],
      dailyCompletions: [],
      totalCompletedSessions: 0,
    });
  });

  it('migrates v1 aliases and writes the normalized v2 copy', () => {
    localStorage.setItem('gm-mind-cascade-progress-v1', JSON.stringify({
      version: 1,
      updatedAt: 2_500,
      difficulty: 4,
      currentSession: resume('legacy-session'),
      replayArchive: [replay('legacy-replay', 'legacy-complete')],
      sessions: [performance('legacy-complete')],
      unlockedAchievements: ['first-solution'],
      completedDailyChallenges: ['daily:2026-07-30:mind-cascade-daily-v1'],
      sessionsCompleted: 3,
    }));

    const loaded = loadMindCascadeProgressResult(localStorage);
    expect(loaded.status).toBe('migrated');
    expect(loaded.persisted).toBe(true);
    expect(loaded.state).toMatchObject({
      version: 2,
      selectedDifficulty: 4,
      totalCompletedSessions: 3,
    });
    expect(loaded.state.resumableSession?.id).toBe('legacy-session');
    expect(loaded.state.replays[0].id).toBe('legacy-replay');
    expect(loaded.state.achievements[0].id).toBe('first-solution');
    expect(JSON.parse(localStorage.getItem(MIND_CASCADE_PROGRESS_STORAGE_KEY)!))
      .toMatchObject({ version: 2, selectedDifficulty: 4 });
  });

  it('drops malformed nested records instead of trusting persisted input', () => {
    const normalized = normalizeMindCascadeProgress({
      version: 2,
      updatedAt: -8,
      selectedDifficulty: 99,
      resumableSession: { id: 'broken' },
      replays: [{ id: 'missing-required-fields' }],
      performanceHistory: [
        performance('valid'),
        { sessionId: '', completedAt: 'yesterday' },
      ],
      achievements: [{ id: 'not-a-real-badge', unlockedAt: 2 }],
      dailyCompletions: ['daily:valid', 'external:not-daily'],
    });

    expect(normalized.updatedAt).toBe(0);
    expect(normalized.selectedDifficulty).toBe(2);
    expect(normalized.resumableSession).toBeNull();
    expect(normalized.replays).toEqual([]);
    expect(normalized.performanceHistory.map((item) => item.sessionId)).toEqual(['valid']);
    expect(normalized.achievements).toEqual([]);
    expect(normalized.dailyCompletions).toEqual(['daily:valid']);
  });

  it('returns null only for unreadable JSON and recovers to a clean state', () => {
    expect(parseMindCascadeProgress('{not json')).toBeNull();
    localStorage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, '{not json');

    const loaded = loadMindCascadeProgressResult(localStorage);
    expect(loaded.status).toBe('recovered');
    expect(loaded.state).toEqual(createEmptyMindCascadeProgress());
    expect(loaded.warning).toContain('clean recovery state');
  });
});

describe('resumable session and replay archive', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a deterministic engine snapshot and replay steps', () => {
    const state = withResumableMindCascadeSession(
      createEmptyMindCascadeProgress(),
      resume(),
    );
    expect(saveMindCascadeProgress(state, localStorage).persisted).toBe(true);

    const loaded = loadMindCascadeProgress(localStorage);
    expect(loaded.resumableSession).toEqual(resume());
    expect(loaded.selectedDifficulty).toBe(3);
  });

  it('creates a portable resume directly from deterministic engine state', () => {
    const initial = createGame({ seed: 91, levelId: 'cascade-atlas' });
    const state = applyMove(initial, getValidMoves(initial)[0]);
    const snapshot = createResumableMindCascadeSession({
      id: 'engine-session',
      mode: 'practice',
      difficulty: 3,
      startedAt: 100,
      savedAt: 200,
      state,
      observations: {
        invalidSwaps: 2,
        wastedSwaps: 1,
        hintsUsed: 1,
        forecastsUsed: 3,
        planningTimeMs: 12_000,
        planningSamples: 1,
      },
    });

    expect(snapshot).toMatchObject({
      id: 'engine-session',
      seed: state.seed,
      moveNumber: 1,
      score: state.score,
    });
    expect(snapshot.state).toEqual(state);
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.steps[0]).toMatchObject({
      turn: 1,
      cascadeDepth: state.history[0].cascades.length,
      boardHash: state.history[0].afterHash,
    });
    expect(snapshot.observations).toEqual({
      invalidSwaps: 2,
      wastedSwaps: 1,
      hintsUsed: 1,
      forecastsUsed: 3,
      planningTimeMs: 12_000,
      planningSamples: 1,
    });
  });

  it('rejects circular or non-JSON engine snapshots before persistence', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const invalid = resume();
    invalid.state = circular as never;

    expect(() => withResumableMindCascadeSession(
      createEmptyMindCascadeProgress(),
      invalid,
    )).toThrow(/not valid JSON game state/);
  });

  it('clears a resume explicitly without losing other progress', () => {
    const initial = {
      ...withResumableMindCascadeSession(createEmptyMindCascadeProgress(), resume()),
      totalCompletedSessions: 4,
    };
    const cleared = withoutResumableMindCascadeSession(initial, 3_000);

    expect(cleared.resumableSession).toBeNull();
    expect(cleared.totalCompletedSessions).toBe(4);
    expect(cleared.updatedAt).toBe(3_000);
  });

  it('archives a completion, clears only its matching resume, and is idempotent', () => {
    const initial = withResumableMindCascadeSession(
      createEmptyMindCascadeProgress(),
      resume('session-1'),
    );
    const completed = {
      performance: performance('session-1'),
      replay: replay('replay-1', 'session-1'),
    };
    const once = completeMindCascadeSession(initial, completed);
    const twice = completeMindCascadeSession(once, completed);

    expect(once.resumableSession).toBeNull();
    expect(once.performanceHistory).toHaveLength(1);
    expect(once.replays).toHaveLength(1);
    expect(once.totalCompletedSessions).toBe(1);
    expect(twice.performanceHistory).toHaveLength(1);
    expect(twice.replays).toHaveLength(1);
    expect(twice.totalCompletedSessions).toBe(1);
    expect(twice.achievements.map((item) => item.id)).toContain('first-solution');
  });

  it('preserves a newer unrelated resumable session', () => {
    const initial = withResumableMindCascadeSession(
      createEmptyMindCascadeProgress(),
      resume('session-new'),
    );
    const completed = completeMindCascadeSession(initial, {
      performance: performance('session-old'),
      replay: replay('replay-old', 'session-old'),
    });

    expect(completed.resumableSession?.id).toBe('session-new');
  });

  it('counts only solved daily challenges as daily completions', () => {
    const failed = completeMindCascadeSession(createEmptyMindCascadeProgress(), {
      performance: performance('daily-failed'),
      replay: replay('daily-failed-replay', 'daily-failed', {
        mode: 'daily',
        outcome: 'moves-exhausted',
        dailyChallengeId: 'daily:2026-07-30:mind-cascade-daily-v1',
      }),
      dailyChallengeId: 'daily:2026-07-30:mind-cascade-daily-v1',
    });
    expect(failed.dailyCompletions).toEqual([]);

    const solved = completeMindCascadeSession(failed, {
      performance: performance('daily-solved'),
      replay: replay('daily-solved-replay', 'daily-solved', {
        mode: 'daily',
        outcome: 'objective-complete',
        dailyChallengeId: 'daily:2026-07-31:mind-cascade-daily-v1',
      }),
      dailyChallengeId: 'daily:2026-07-31:mind-cascade-daily-v1',
    });
    expect(solved.dailyCompletions).toEqual([
      'daily:2026-07-31:mind-cascade-daily-v1',
    ]);
  });

  it('refuses unfinished or mismatched completion evidence', () => {
    const unfinished = performance('unfinished', { completed: false });
    expect(() => completeMindCascadeSession(createEmptyMindCascadeProgress(), {
      performance: unfinished,
      replay: replay('unfinished-replay', 'unfinished', {
        performance: unfinished,
      }),
    })).toThrow(/same valid session/);

    expect(() => completeMindCascadeSession(createEmptyMindCascadeProgress(), {
      performance: performance('performance-id'),
      replay: replay('mismatch-replay', 'other-id'),
    })).toThrow(/same valid session/);
  });

  it('caps the replay archive at the newest fixed number', () => {
    const oversized = normalizeMindCascadeProgress({
      ...createEmptyMindCascadeProgress(),
      replays: Array.from({ length: MAX_MIND_CASCADE_REPLAYS + 5 }, (_, index) =>
        replay(`replay-${index}`, `session-${index}`, {
          completedAt: 2_000 + index,
          performance: performance(`session-${index}`, { completedAt: 2_000 + index }),
        })),
    });

    expect(oversized.replays).toHaveLength(MAX_MIND_CASCADE_REPLAYS);
    expect(oversized.replays[0].id).toBe(`replay-${MAX_MIND_CASCADE_REPLAYS + 4}`);
    expect(oversized.replays.at(-1)?.id).toBe('replay-5');
  });
});

describe('fixed badge achievements', () => {
  it('contains only deterministic badge rewards', () => {
    expect(MIND_CASCADE_ACHIEVEMENTS).toHaveLength(8);
    expect(new Set(MIND_CASCADE_ACHIEVEMENTS.map((item) => item.id)).size).toBe(8);
    expect(MIND_CASCADE_ACHIEVEMENTS.every((item) => item.reward === 'badge')).toBe(true);
    expect(MIND_CASCADE_ACHIEVEMENTS.find((item) => item.id === 'daily-scholar')?.description)
      .toContain('no consecutive-day requirement');
  });

  it('unlocks evidence-based single-session badges and never duplicates them', () => {
    const qualifying = performance('qualifying', {
      moves: 12,
      successfulSwaps: 12,
      invalidSwaps: 0,
      wastedSwaps: 0,
      maxCascadeDepth: 5,
      hintsUsed: 0,
      forecastsUsed: 0,
    });
    const completed = completeMindCascadeSession(createEmptyMindCascadeProgress(), {
      performance: qualifying,
      replay: replay('qualifying-replay', 'qualifying', {
        performance: qualifying,
      }),
    }, 5_000);
    const reevaluated = evaluateMindCascadeAchievements(completed, 6_000);
    const ids = reevaluated.achievements.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining([
      'first-solution',
      'precise-thinker',
      'cascade-architect',
      'objective-architect',
      'independent-strategist',
    ]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(reevaluated.achievements.every(
      (item) => item.evidenceSessionId === 'qualifying',
    )).toBe(true);
  });

  it('awards daily study for five distinct boards without streak pressure', () => {
    let state = createEmptyMindCascadeProgress();
    for (let index = 0; index < 5; index += 1) {
      const sessionId = `daily-session-${index}`;
      const dailyChallengeId = `daily:2026-08-${String(index * 2 + 1).padStart(2, '0')}:mind-cascade-daily-v1`;
      const sessionPerformance = performance(sessionId, { completedAt: 2_000 + index });
      state = completeMindCascadeSession(state, {
        performance: sessionPerformance,
        replay: replay(`daily-replay-${index}`, sessionId, {
          mode: 'daily',
          completedAt: 2_000 + index,
          dailyChallengeId,
          performance: sessionPerformance,
        }),
        dailyChallengeId,
      });
    }

    expect(state.dailyCompletions).toHaveLength(5);
    expect(state.achievements.map((item) => item.id)).toContain('daily-scholar');
  });
});

describe('failure-safe repository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the normalized update in memory when writes are denied', () => {
    const denied: MindCascadeProgressStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const repository = createMindCascadeProgressRepository(denied);
    const saved = repository.save({
      ...createEmptyMindCascadeProgress(),
      totalCompletedSessions: 7,
    });

    expect(saved.persisted).toBe(false);
    expect(saved.warning).toContain('remains available for this session');
    expect(repository.current().totalCompletedSessions).toBe(7);
    expect(repository.load().state.totalCompletedSessions).toBe(7);
  });

  it('runs in memory when localStorage is intentionally unavailable', () => {
    const repository = createMindCascadeProgressRepository(null);
    expect(repository.load()).toMatchObject({
      status: 'memory-only',
      persisted: false,
    });
    const updated = repository.update((state) => ({
      ...state,
      selectedDifficulty: 4,
    }));
    expect(updated.persisted).toBe(false);
    expect(repository.current().selectedDifficulty).toBe(4);
  });

  it('reports an oversized archive without throwing or losing session memory', () => {
    const repository = createMindCascadeProgressRepository(localStorage);
    const huge = withResumableMindCascadeSession(
      createEmptyMindCascadeProgress(),
      resume('huge', { state: { note: 'x'.repeat(1_600_000) } }),
    );
    const result = repository.save(huge);

    expect(result.persisted).toBe(false);
    expect(result.warning).toContain('too large');
    expect(repository.current().resumableSession?.id).toBe('huge');
  });

  it('clears primary and legacy keys without exposing storage errors', () => {
    localStorage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, '{}');
    localStorage.setItem('gm-mind-cascade-progress-v1', '{}');
    const repository = createMindCascadeProgressRepository(localStorage);

    expect(repository.clear().persisted).toBe(true);
    expect(localStorage.getItem(MIND_CASCADE_PROGRESS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('gm-mind-cascade-progress-v1')).toBeNull();
  });
});
