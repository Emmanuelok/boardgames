import {
  MIND_DIFFICULTIES,
  type MindCascadePerformance,
  type MindDifficulty,
} from './intelligence';
import type { MindGameState, TurnRecord } from './engine';

export const MIND_CASCADE_PROGRESS_VERSION = 2 as const;
export const MIND_CASCADE_PROGRESS_STORAGE_KEY = 'gm-mind-cascade-progress-v2';
export const MIND_CASCADE_LEGACY_STORAGE_KEYS = [
  'gm-mind-cascade-progress-v1',
  'mind-cascade-progress',
] as const;
export const MIND_CASCADE_PROGRESS_CHANGED_EVENT = 'gm-mind-cascade-progress-changed';

export const MAX_MIND_CASCADE_REPLAYS = 40;
export const MAX_MIND_CASCADE_PERFORMANCE_SESSIONS = 80;
export const MAX_MIND_CASCADE_REPLAY_STEPS = 500;
export const MAX_MIND_CASCADE_DAILY_COMPLETIONS = 400;
export const MAX_MIND_CASCADE_STORAGE_BYTES = 1_500_000;

const MAX_ID_LENGTH = 180;
const MAX_TITLE_LENGTH = 120;
const MAX_ENGINE_VERSION_LENGTH = 40;
const MAX_BOARD_HASH_LENGTH = 120;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type MindCascadeMode = 'classic' | 'daily' | 'journey' | 'practice';
export type MindCascadeReplayOutcome = 'objective-complete' | 'moves-exhausted' | 'completed';

export interface MindCascadeReplayStep {
  turn: number;
  action: JsonValue;
  scoreDelta: number;
  objectiveDelta: number;
  cascadeDepth: number;
  boardHash?: string;
}

export interface MindCascadeSessionObservations {
  invalidSwaps: number;
  wastedSwaps: number;
  hintsUsed: number;
  forecastsUsed: number;
  planningTimeMs: number;
  planningSamples: number;
}

/**
 * A deliberately narrow persistence boundary. Engine state can evolve without
 * coupling storage to its classes as long as it can be represented as JSON.
 */
export interface ResumableMindCascadeSession {
  id: string;
  mode: MindCascadeMode;
  engineVersion: string;
  seed: number;
  difficulty: MindDifficulty;
  startedAt: number;
  savedAt: number;
  moveNumber: number;
  score: number;
  dailyChallengeId?: string;
  observations?: MindCascadeSessionObservations;
  state: JsonValue;
  steps: MindCascadeReplayStep[];
}

export interface CreateResumableMindCascadeSessionInput {
  id: string;
  mode: MindCascadeMode;
  difficulty: MindDifficulty;
  startedAt: number;
  savedAt: number;
  state: MindGameState;
  dailyChallengeId?: string;
  observations?: MindCascadeSessionObservations;
}

export interface MindCascadeReplay {
  id: string;
  sessionId: string;
  title: string;
  mode: MindCascadeMode;
  engineVersion: string;
  seed: number;
  difficulty: MindDifficulty;
  startedAt: number;
  completedAt: number;
  outcome: MindCascadeReplayOutcome;
  score: number;
  dailyChallengeId?: string;
  steps: MindCascadeReplayStep[];
  performance: MindCascadePerformance;
}

export const MIND_CASCADE_ACHIEVEMENT_IDS = [
  'first-solution',
  'precise-thinker',
  'cascade-architect',
  'objective-architect',
  'independent-strategist',
  'daily-scholar',
  'replay-researcher',
  'strategy-scholar',
] as const;

export type MindCascadeAchievementId =
  (typeof MIND_CASCADE_ACHIEVEMENT_IDS)[number];

export interface MindCascadeAchievementDefinition {
  id: MindCascadeAchievementId;
  title: string;
  description: string;
  icon: string;
  reward: 'badge';
}

export interface MindCascadeAchievementUnlock {
  id: MindCascadeAchievementId;
  unlockedAt: number;
  evidenceSessionId?: string;
}

/**
 * Every achievement has a fixed, inspectable condition. There are no loot
 * boxes, random rewards, paid lives, streak penalties, or spendable prizes.
 */
export const MIND_CASCADE_ACHIEVEMENTS: readonly MindCascadeAchievementDefinition[] = [
  {
    id: 'first-solution',
    title: 'First Principle',
    description: 'Complete one Mind Cascade session.',
    icon: 'spark',
    reward: 'badge',
  },
  {
    id: 'precise-thinker',
    title: 'Precise Thinker',
    description: 'Make at least 8 productive swaps with no invalid or unproductive swaps in one session.',
    icon: 'target',
    reward: 'badge',
  },
  {
    id: 'cascade-architect',
    title: 'Cascade Architect',
    description: 'Create a cascade at least 5 links deep.',
    icon: 'cascade',
    reward: 'badge',
  },
  {
    id: 'objective-architect',
    title: 'Objective Architect',
    description: 'Complete at least 3 objectives within the available move allowance.',
    icon: 'blueprint',
    reward: 'badge',
  },
  {
    id: 'independent-strategist',
    title: 'Independent Strategist',
    description: 'Complete at least 10 moves without opening a hint or forecast.',
    icon: 'compass',
    reward: 'badge',
  },
  {
    id: 'daily-scholar',
    title: 'Daily Scholar',
    description: 'Complete five different daily challenges, with no consecutive-day requirement.',
    icon: 'calendar',
    reward: 'badge',
  },
  {
    id: 'replay-researcher',
    title: 'Replay Researcher',
    description: 'Archive five completed sessions for reflection.',
    icon: 'replay',
    reward: 'badge',
  },
  {
    id: 'strategy-scholar',
    title: 'Strategy Scholar',
    description: 'Complete 10 Mind Cascade sessions.',
    icon: 'book',
    reward: 'badge',
  },
] as const;

export interface MindCascadeProgress {
  version: typeof MIND_CASCADE_PROGRESS_VERSION;
  updatedAt: number;
  selectedDifficulty: MindDifficulty;
  resumableSession: ResumableMindCascadeSession | null;
  replays: MindCascadeReplay[];
  performanceHistory: MindCascadePerformance[];
  achievements: MindCascadeAchievementUnlock[];
  dailyCompletions: string[];
  totalCompletedSessions: number;
}

export interface CompletedMindCascadeSession {
  performance: MindCascadePerformance;
  replay: MindCascadeReplay;
  dailyChallengeId?: string;
}

export interface MindCascadeProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MindCascadeLoadStatus =
  | 'loaded'
  | 'empty'
  | 'migrated'
  | 'recovered'
  | 'memory-only';

export interface MindCascadeLoadResult {
  state: MindCascadeProgress;
  status: MindCascadeLoadStatus;
  persisted: boolean;
  warning?: string;
}

export interface MindCascadeSaveResult {
  state: MindCascadeProgress;
  persisted: boolean;
  warning?: string;
}

export interface MindCascadeProgressRepository {
  load: () => MindCascadeLoadResult;
  current: () => MindCascadeProgress;
  save: (state: MindCascadeProgress) => MindCascadeSaveResult;
  update: (
    update: (state: MindCascadeProgress) => MindCascadeProgress,
  ) => MindCascadeSaveResult;
  clear: () => MindCascadeSaveResult;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().slice(0, maxLength);
  return result.length > 0 ? result : null;
}

function cleanId(value: unknown): string | null {
  return cleanText(value, MAX_ID_LENGTH);
}

function cleanTimestamp(value: unknown, fallback?: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
  }
  return fallback === undefined ? null : fallback;
}

function cleanInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback?: number,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback === undefined ? null : fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function cleanNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback?: number,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback === undefined ? null : fallback;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function isDifficulty(value: unknown): value is MindDifficulty {
  return typeof value === 'number'
    && (MIND_DIFFICULTIES as readonly number[]).includes(value);
}

function cleanMode(value: unknown): MindCascadeMode {
  return value === 'daily'
    || value === 'journey'
    || value === 'practice'
    || value === 'classic'
    ? value
    : 'classic';
}

function cleanOutcome(value: unknown): MindCascadeReplayOutcome {
  return value === 'objective-complete'
    || value === 'moves-exhausted'
    || value === 'completed'
    ? value
    : 'completed';
}

function jsonValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue | undefined {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth > 16 || seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > 5_000) return undefined;
    const output: JsonValue[] = [];
    for (const item of value) {
      const clean = jsonValue(item, depth + 1, seen);
      if (clean === undefined) return undefined;
      output.push(clean);
    }
    seen.delete(value);
    return output;
  }

  const entries = Object.entries(value as UnknownRecord);
  if (entries.length > 2_000) return undefined;
  const output: { [key: string]: JsonValue } = {};
  for (const [key, item] of entries) {
    if (key.length > 120) return undefined;
    const clean = jsonValue(item, depth + 1, seen);
    if (clean === undefined) return undefined;
    output[key] = clean;
  }
  seen.delete(value);
  return output;
}

function normalizeReplayStep(value: unknown): MindCascadeReplayStep | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const turn = cleanInteger(raw.turn ?? raw.ply, 0, 100_000);
  const action = jsonValue(raw.action ?? raw.move);
  if (turn === null || action === undefined) return null;
  const boardHash = cleanText(raw.boardHash, MAX_BOARD_HASH_LENGTH) ?? undefined;
  return {
    turn,
    action,
    scoreDelta: cleanNumber(raw.scoreDelta, -1_000_000, 1_000_000, 0)!,
    objectiveDelta: cleanInteger(raw.objectiveDelta, -1_000, 1_000, 0)!,
    cascadeDepth: cleanInteger(raw.cascadeDepth, 0, 1_000, 0)!,
    ...(boardHash ? { boardHash } : {}),
  };
}

/** Convert deterministic engine turns into the compact, portable replay form. */
export function mindCascadeReplayStepsFromEngine(
  records: ReadonlyArray<TurnRecord>,
): MindCascadeReplayStep[] {
  return normalizeSteps(records.map((record) => ({
    turn: record.turn,
    action: {
      swap: record.swap,
      rngBefore: record.rngBefore,
      rngAfter: record.rngAfter,
      reshuffled: record.reshuffled,
    },
    scoreDelta: record.scoreDelta,
    objectiveDelta: 0,
    cascadeDepth: record.cascades.length,
    boardHash: record.afterHash,
  })));
}

function normalizeSteps(value: unknown): MindCascadeReplayStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeReplayStep)
    .filter((step): step is MindCascadeReplayStep => step !== null)
    .sort((a, b) => a.turn - b.turn)
    .slice(-MAX_MIND_CASCADE_REPLAY_STEPS);
}

export function normalizeMindCascadePerformance(
  value: unknown,
): MindCascadePerformance | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const sessionId = cleanId(raw.sessionId ?? raw.id);
  const completedAt = cleanTimestamp(raw.completedAt ?? raw.endedAt);
  const difficulty = isDifficulty(raw.difficulty) ? raw.difficulty : 2;
  if (!sessionId || completedAt === null) return null;

  return {
    sessionId,
    completedAt,
    difficulty,
    moves: cleanInteger(raw.moves ?? raw.turnsUsed, 0, 100_000, 0)!,
    successfulSwaps: cleanInteger(
      raw.successfulSwaps ?? raw.validSwaps,
      0,
      100_000,
      0,
    )!,
    invalidSwaps: cleanInteger(
      raw.invalidSwaps ?? raw.invalidMoves,
      0,
      100_000,
      0,
    )!,
    wastedSwaps: cleanInteger(
      raw.wastedSwaps ?? raw.deadSwaps,
      0,
      100_000,
      0,
    )!,
    objectivesCompleted: cleanInteger(
      raw.objectivesCompleted,
      0,
      100_000,
      0,
    )!,
    objectiveTarget: cleanInteger(
      raw.objectiveTarget ?? raw.totalObjectives,
      0,
      100_000,
      0,
    )!,
    turnsUsed: cleanInteger(raw.turnsUsed ?? raw.moves, 0, 100_000, 0)!,
    ...(cleanInteger(raw.turnBudget, 1, 100_000) !== null
      ? { turnBudget: cleanInteger(raw.turnBudget, 1, 100_000)! }
      : {}),
    maxCascadeDepth: cleanInteger(raw.maxCascadeDepth, 0, 1_000, 0)!,
    cascadeDepthTotal: cleanNumber(raw.cascadeDepthTotal, 0, 1_000_000, 0)!,
    cascadesResolved: cleanInteger(raw.cascadesResolved, 0, 100_000, 0)!,
    hintsUsed: cleanInteger(raw.hintsUsed, 0, 100_000, 0)!,
    forecastsUsed: cleanInteger(raw.forecastsUsed, 0, 100_000, 0)!,
    planningTimeMs: cleanNumber(raw.planningTimeMs, 0, 86_400_000, 0)!,
    planningSamples: cleanInteger(raw.planningSamples, 0, 100_000, 0)!,
    completed: raw.completed !== false,
  };
}

function normalizeResumableSession(
  value: unknown,
): ResumableMindCascadeSession | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = cleanId(raw.id ?? raw.sessionId);
  const engineVersion = cleanText(
    raw.engineVersion ?? raw.rulesVersion,
    MAX_ENGINE_VERSION_LENGTH,
  );
  const startedAt = cleanTimestamp(raw.startedAt);
  const savedAt = cleanTimestamp(raw.savedAt ?? raw.updatedAt);
  const state = jsonValue(raw.state ?? raw.gameState);
  if (
    !id
    || !engineVersion
    || startedAt === null
    || savedAt === null
    || state === undefined
    || state === null
    || typeof state !== 'object'
  ) return null;
  const dailyChallengeId = cleanId(raw.dailyChallengeId) ?? undefined;
  const observationRecord = asRecord(raw.observations);
  const observations = observationRecord ? {
    invalidSwaps: cleanInteger(observationRecord.invalidSwaps, 0, 100_000, 0)!,
    wastedSwaps: cleanInteger(observationRecord.wastedSwaps, 0, 100_000, 0)!,
    hintsUsed: cleanInteger(observationRecord.hintsUsed, 0, 100_000, 0)!,
    forecastsUsed: cleanInteger(observationRecord.forecastsUsed, 0, 100_000, 0)!,
    planningTimeMs: cleanNumber(observationRecord.planningTimeMs, 0, 86_400_000, 0)!,
    planningSamples: cleanInteger(observationRecord.planningSamples, 0, 100_000, 0)!,
  } : undefined;

  return {
    id,
    mode: cleanMode(raw.mode),
    engineVersion,
    seed: cleanInteger(raw.seed, 0, 0xffff_ffff, 1)!,
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : 2,
    startedAt,
    savedAt: Math.max(startedAt, savedAt),
    moveNumber: cleanInteger(raw.moveNumber ?? raw.turn, 0, 100_000, 0)!,
    score: cleanNumber(raw.score, -1_000_000_000, 1_000_000_000, 0)!,
    ...(dailyChallengeId ? { dailyChallengeId } : {}),
    ...(observations ? { observations } : {}),
    state,
    steps: normalizeSteps(raw.steps ?? raw.moves),
  };
}

function normalizeReplay(value: unknown): MindCascadeReplay | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = cleanId(raw.id);
  const sessionId = cleanId(raw.sessionId);
  const engineVersion = cleanText(
    raw.engineVersion ?? raw.rulesVersion,
    MAX_ENGINE_VERSION_LENGTH,
  );
  const startedAt = cleanTimestamp(raw.startedAt);
  const completedAt = cleanTimestamp(raw.completedAt ?? raw.endedAt);
  const performance = normalizeMindCascadePerformance(
    raw.performance ?? {
      ...raw,
      sessionId,
      completedAt,
    },
  );
  if (
    !id
    || !sessionId
    || !engineVersion
    || startedAt === null
    || completedAt === null
    || !performance
  ) return null;
  const dailyChallengeId = cleanId(raw.dailyChallengeId) ?? undefined;

  return {
    id,
    sessionId,
    title: cleanText(raw.title, MAX_TITLE_LENGTH) ?? 'Mind Cascade replay',
    mode: cleanMode(raw.mode),
    engineVersion,
    seed: cleanInteger(raw.seed, 0, 0xffff_ffff, 1)!,
    difficulty: isDifficulty(raw.difficulty)
      ? raw.difficulty
      : performance.difficulty,
    startedAt,
    completedAt: Math.max(startedAt, completedAt),
    outcome: cleanOutcome(raw.outcome),
    score: cleanNumber(raw.score, -1_000_000_000, 1_000_000_000, 0)!,
    ...(dailyChallengeId ? { dailyChallengeId } : {}),
    steps: normalizeSteps(raw.steps ?? raw.moves),
    performance,
  };
}

function isAchievementId(value: unknown): value is MindCascadeAchievementId {
  return typeof value === 'string'
    && (MIND_CASCADE_ACHIEVEMENT_IDS as readonly string[]).includes(value);
}

function normalizeAchievement(
  value: unknown,
  fallbackAt: number,
): MindCascadeAchievementUnlock | null {
  if (isAchievementId(value)) return { id: value, unlockedAt: fallbackAt };
  const raw = asRecord(value);
  if (!raw || !isAchievementId(raw.id)) return null;
  const evidenceSessionId = cleanId(raw.evidenceSessionId) ?? undefined;
  return {
    id: raw.id,
    unlockedAt: cleanTimestamp(raw.unlockedAt, fallbackAt)!,
    ...(evidenceSessionId ? { evidenceSessionId } : {}),
  };
}

function newestUnique<T>(
  values: unknown,
  normalize: (value: unknown) => T | null,
  id: (value: T) => string,
  time: (value: T) => number,
  max: number,
): T[] {
  if (!Array.isArray(values)) return [];
  const sorted = values
    .map(normalize)
    .filter((item): item is T => item !== null)
    .sort((a, b) => time(b) - time(a) || id(a).localeCompare(id(b)));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of sorted) {
    if (seen.has(id(item))) continue;
    seen.add(id(item));
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

function cleanDailyCompletions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => cleanId(item))
    .filter((item): item is string => item !== null && item.startsWith('daily:')))]
    .sort()
    .slice(-MAX_MIND_CASCADE_DAILY_COMPLETIONS);
}

export function createEmptyMindCascadeProgress(
  updatedAt = 0,
): MindCascadeProgress {
  return {
    version: MIND_CASCADE_PROGRESS_VERSION,
    updatedAt,
    selectedDifficulty: 2,
    resumableSession: null,
    replays: [],
    performanceHistory: [],
    achievements: [],
    dailyCompletions: [],
    totalCompletedSessions: 0,
  };
}

/**
 * Runtime-safe v1/v2 normalizer. v1 aliases include `currentSession`,
 * `replayArchive`, `sessions`, `unlockedAchievements`, and `difficulty`.
 */
export function normalizeMindCascadeProgress(value: unknown): MindCascadeProgress {
  const raw = asRecord(value);
  if (!raw) return createEmptyMindCascadeProgress();
  const updatedAt = cleanTimestamp(raw.updatedAt, 0)!;
  const performanceHistory = newestUnique(
    raw.performanceHistory ?? raw.sessionHistory ?? raw.sessions,
    normalizeMindCascadePerformance,
    (performance) => performance.sessionId,
    (performance) => performance.completedAt,
    MAX_MIND_CASCADE_PERFORMANCE_SESSIONS,
  );
  const replays = newestUnique(
    raw.replays ?? raw.replayArchive,
    normalizeReplay,
    (replay) => replay.id,
    (replay) => replay.completedAt,
    MAX_MIND_CASCADE_REPLAYS,
  );
  const achievementValues = raw.achievements ?? raw.unlockedAchievements;
  const achievements = newestUnique(
    achievementValues,
    (achievement) => normalizeAchievement(achievement, updatedAt),
    (achievement) => achievement.id,
    (achievement) => achievement.unlockedAt,
    MIND_CASCADE_ACHIEVEMENT_IDS.length,
  ).sort((a, b) => a.unlockedAt - b.unlockedAt || a.id.localeCompare(b.id));

  return {
    version: MIND_CASCADE_PROGRESS_VERSION,
    updatedAt,
    selectedDifficulty: isDifficulty(raw.selectedDifficulty)
      ? raw.selectedDifficulty
      : isDifficulty(raw.difficulty)
        ? raw.difficulty
        : 2,
    resumableSession: normalizeResumableSession(
      raw.resumableSession ?? raw.currentSession ?? raw.resume,
    ),
    replays,
    performanceHistory,
    achievements,
    dailyCompletions: cleanDailyCompletions(
      raw.dailyCompletions ?? raw.completedDailyChallenges,
    ),
    totalCompletedSessions: Math.max(
      performanceHistory.length,
      cleanInteger(
        raw.totalCompletedSessions ?? raw.sessionsCompleted,
        0,
        10_000_000,
        performanceHistory.length,
      )!,
    ),
  };
}

export function parseMindCascadeProgress(serialized: string): MindCascadeProgress | null {
  try {
    return normalizeMindCascadeProgress(JSON.parse(serialized));
  } catch {
    return null;
  }
}

/**
 * Create a valid resume directly from the engine. Runtime JSON validation is
 * still applied, so a future non-serializable engine field fails loudly here
 * instead of corrupting saved progress.
 */
export function createResumableMindCascadeSession(
  input: CreateResumableMindCascadeSessionInput,
): ResumableMindCascadeSession {
  return normalizeRequiredResume({
    id: input.id,
    mode: input.mode,
    engineVersion: String(input.state.version),
    seed: input.state.seed,
    difficulty: input.difficulty,
    startedAt: input.startedAt,
    savedAt: input.savedAt,
    moveNumber: input.state.turn,
    score: input.state.score,
    ...(input.dailyChallengeId
      ? { dailyChallengeId: input.dailyChallengeId }
      : {}),
    ...(input.observations ? { observations: input.observations } : {}),
    state: jsonValue(input.state) as JsonValue,
    steps: mindCascadeReplayStepsFromEngine(input.state.history),
  });
}

function normalizeRequiredResume(
  session: ResumableMindCascadeSession,
): ResumableMindCascadeSession {
  const normalized = normalizeResumableSession(session);
  if (!normalized) {
    throw new Error('The resumable Mind Cascade session is not valid JSON game state.');
  }
  return normalized;
}

export function withResumableMindCascadeSession(
  progress: MindCascadeProgress,
  session: ResumableMindCascadeSession,
): MindCascadeProgress {
  const resumableSession = normalizeRequiredResume(session);
  return {
    ...normalizeMindCascadeProgress(progress),
    updatedAt: Math.max(progress.updatedAt, resumableSession.savedAt),
    selectedDifficulty: resumableSession.difficulty,
    resumableSession,
  };
}

export function withoutResumableMindCascadeSession(
  progress: MindCascadeProgress,
  updatedAt = Date.now(),
): MindCascadeProgress {
  return {
    ...normalizeMindCascadeProgress(progress),
    updatedAt: Math.max(progress.updatedAt, updatedAt),
    resumableSession: null,
  };
}

function findAchievementEvidence(
  id: MindCascadeAchievementId,
  state: MindCascadeProgress,
): string | undefined {
  const history = state.performanceHistory;
  if (id === 'first-solution') {
    return history[history.length - 1]?.sessionId ?? history[0]?.sessionId;
  }
  if (id === 'precise-thinker') return history.find((session) =>
    session.successfulSwaps >= 8
      && session.invalidSwaps === 0
      && session.wastedSwaps === 0)?.sessionId;
  if (id === 'cascade-architect') return history.find(
    (session) => session.maxCascadeDepth >= 5,
  )?.sessionId;
  if (id === 'objective-architect') return history.find((session) =>
    session.objectiveTarget >= 3
      && session.objectivesCompleted >= session.objectiveTarget
      && (session.turnBudget === undefined || session.turnsUsed <= session.turnBudget))?.sessionId;
  if (id === 'independent-strategist') return history.find((session) =>
    session.moves >= 10
      && session.hintsUsed === 0
      && session.forecastsUsed === 0)?.sessionId;
  if (id === 'daily-scholar') return state.dailyCompletions.length >= 5
    ? history.find((session) => state.replays.some(
        (replay) => replay.sessionId === session.sessionId && replay.dailyChallengeId,
      ))?.sessionId
    : undefined;
  if (id === 'replay-researcher') return state.replays.length >= 5
    ? state.replays[0]?.sessionId
    : undefined;
  if (id === 'strategy-scholar') return state.totalCompletedSessions >= 10
    ? history[0]?.sessionId
    : undefined;
  return undefined;
}

export function evaluateMindCascadeAchievements(
  progress: MindCascadeProgress,
  unlockedAt = Date.now(),
): MindCascadeProgress {
  const state = normalizeMindCascadeProgress(progress);
  const already = new Set(state.achievements.map((achievement) => achievement.id));
  const additions: MindCascadeAchievementUnlock[] = [];
  for (const definition of MIND_CASCADE_ACHIEVEMENTS) {
    if (already.has(definition.id)) continue;
    const evidenceSessionId = findAchievementEvidence(definition.id, state);
    if (!evidenceSessionId) continue;
    additions.push({
      id: definition.id,
      unlockedAt,
      evidenceSessionId,
    });
  }
  if (additions.length === 0) return state;
  return {
    ...state,
    updatedAt: Math.max(state.updatedAt, unlockedAt),
    achievements: [...state.achievements, ...additions],
  };
}

/**
 * Archive a completed session, add its learning evidence, clear only the
 * matching resume, and evaluate fixed badge conditions.
 */
export function completeMindCascadeSession(
  progress: MindCascadeProgress,
  completed: CompletedMindCascadeSession,
  updatedAt = completed.performance.completedAt,
): MindCascadeProgress {
  const state = normalizeMindCascadeProgress(progress);
  const performance = normalizeMindCascadePerformance(completed.performance);
  const replay = normalizeReplay(completed.replay);
  if (
    !performance
    || !performance.completed
    || !replay
    || replay.sessionId !== performance.sessionId
  ) {
    throw new Error('Completed Mind Cascade performance and replay must identify the same valid session.');
  }

  const alreadyCompleted = state.performanceHistory.some(
    (session) => session.sessionId === performance.sessionId,
  );
  const performanceHistory = newestUnique(
    [performance, ...state.performanceHistory],
    normalizeMindCascadePerformance,
    (session) => session.sessionId,
    (session) => session.completedAt,
    MAX_MIND_CASCADE_PERFORMANCE_SESSIONS,
  );
  const replays = newestUnique(
    [replay, ...state.replays],
    normalizeReplay,
    (item) => item.id,
    (item) => item.completedAt,
    MAX_MIND_CASCADE_REPLAYS,
  );
  const dailyChallengeId = cleanId(
    completed.dailyChallengeId ?? replay.dailyChallengeId,
  );
  const dailyCompletions = replay.outcome === 'objective-complete'
    && dailyChallengeId?.startsWith('daily:')
    ? cleanDailyCompletions([...state.dailyCompletions, dailyChallengeId])
    : state.dailyCompletions;

  return evaluateMindCascadeAchievements({
    ...state,
    updatedAt: Math.max(state.updatedAt, updatedAt),
    selectedDifficulty: performance.difficulty,
    resumableSession: state.resumableSession?.id === performance.sessionId
      ? null
      : state.resumableSession,
    replays,
    performanceHistory,
    dailyCompletions,
    totalCompletedSessions: state.totalCompletedSessions + (alreadyCompleted ? 0 : 1),
  }, updatedAt);
}

function browserStorage(): MindCascadeProgressStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function progressWarning(reason: 'read' | 'write' | 'size' | 'remove'): string {
  if (reason === 'size') {
    return 'Progress remains available for this session, but the replay archive is too large to save locally.';
  }
  if (reason === 'write') {
    return 'Progress remains available for this session, but this browser could not save it locally.';
  }
  if (reason === 'remove') {
    return 'Progress was cleared in this session, but the browser could not remove the saved copy.';
  }
  return 'Saved progress could not be read, so Mind Cascade opened a clean recovery state.';
}

function dispatchProgressChanged(state: MindCascadeProgress): void {
  try {
    if (typeof globalThis.dispatchEvent !== 'function') return;
    globalThis.dispatchEvent(new CustomEvent(MIND_CASCADE_PROGRESS_CHANGED_EVENT, {
      detail: { updatedAt: state.updatedAt },
    }));
  } catch {
    // Cross-tab/in-app notification is optional; storage remains authoritative.
  }
}

/**
 * Repository writes to memory first, then localStorage. A privacy setting,
 * quota error, or unavailable storage therefore never interrupts the game.
 */
export function createMindCascadeProgressRepository(
  suppliedStorage?: MindCascadeProgressStorage | null,
): MindCascadeProgressRepository {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  let memory = createEmptyMindCascadeProgress();
  let loaded = false;
  let memoryPersisted = false;

  const save = (incoming: MindCascadeProgress): MindCascadeSaveResult => {
    memory = normalizeMindCascadeProgress(incoming);
    loaded = true;
    const serialized = JSON.stringify(memory);
    const serializedBytes = (() => {
      try {
        return new TextEncoder().encode(serialized).byteLength;
      } catch {
        return serialized.length * 2;
      }
    })();
    if (serializedBytes > MAX_MIND_CASCADE_STORAGE_BYTES) {
      memoryPersisted = false;
      return {
        state: memory,
        persisted: false,
        warning: progressWarning('size'),
      };
    }
    if (!storage) {
      memoryPersisted = false;
      return {
        state: memory,
        persisted: false,
        warning: progressWarning('write'),
      };
    }
    try {
      storage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, serialized);
      memoryPersisted = true;
      dispatchProgressChanged(memory);
      return { state: memory, persisted: true };
    } catch {
      memoryPersisted = false;
      return {
        state: memory,
        persisted: false,
        warning: progressWarning('write'),
      };
    }
  };

  const load = (): MindCascadeLoadResult => {
    if (loaded) {
      return {
        state: memory,
        status: storage ? 'loaded' : 'memory-only',
        persisted: memoryPersisted,
      };
    }
    loaded = true;
    if (!storage) {
      return {
        state: memory,
        status: 'memory-only',
        persisted: false,
        warning: progressWarning('write'),
      };
    }

    let readFailed = false;
    const keys = [
      MIND_CASCADE_PROGRESS_STORAGE_KEY,
      ...MIND_CASCADE_LEGACY_STORAGE_KEYS,
    ];
    for (const key of keys) {
      let serialized: string | null;
      try {
        serialized = storage.getItem(key);
      } catch {
        readFailed = true;
        break;
      }
      if (serialized === null) continue;
      const parsed = parseMindCascadeProgress(serialized);
      if (!parsed) {
        readFailed = true;
        continue;
      }
      memory = parsed;
      memoryPersisted = true;
      const source = (() => {
        try {
          return asRecord(JSON.parse(serialized));
        } catch {
          return null;
        }
      })();
      const migrated = key !== MIND_CASCADE_PROGRESS_STORAGE_KEY
        || source?.version !== MIND_CASCADE_PROGRESS_VERSION;
      if (migrated) {
        const result = save(memory);
        return {
          state: memory,
          status: 'migrated',
          persisted: result.persisted,
          ...((result.warning ?? (readFailed ? progressWarning('read') : undefined))
            ? { warning: result.warning ?? progressWarning('read') }
            : {}),
        };
      }
      return {
        state: memory,
        status: readFailed ? 'recovered' : 'loaded',
        persisted: true,
        ...(readFailed ? { warning: progressWarning('read') } : {}),
      };
    }

    return {
      state: memory,
      status: readFailed ? 'recovered' : 'empty',
      persisted: !readFailed,
      ...(readFailed ? { warning: progressWarning('read') } : {}),
    };
  };

  return {
    load,
    current: () => memory,
    save,
    update: (update) => save(update(load().state)),
    clear: () => {
      memory = createEmptyMindCascadeProgress(Date.now());
      loaded = true;
      if (!storage) {
        return {
          state: memory,
          persisted: false,
          warning: progressWarning('remove'),
        };
      }
      try {
        storage.removeItem(MIND_CASCADE_PROGRESS_STORAGE_KEY);
        for (const key of MIND_CASCADE_LEGACY_STORAGE_KEYS) storage.removeItem(key);
        memoryPersisted = true;
        dispatchProgressChanged(memory);
        return { state: memory, persisted: true };
      } catch {
        memoryPersisted = false;
        return {
          state: memory,
          persisted: false,
          warning: progressWarning('remove'),
        };
      }
    },
  };
}

export function loadMindCascadeProgressResult(
  storage?: MindCascadeProgressStorage | null,
): MindCascadeLoadResult {
  return createMindCascadeProgressRepository(storage).load();
}

/** Convenience loader for UI code that only needs the normalized state. */
export function loadMindCascadeProgress(
  storage?: MindCascadeProgressStorage | null,
): MindCascadeProgress {
  return loadMindCascadeProgressResult(storage).state;
}

export function saveMindCascadeProgress(
  state: MindCascadeProgress,
  storage?: MindCascadeProgressStorage | null,
): MindCascadeSaveResult {
  return createMindCascadeProgressRepository(storage).save(state);
}
