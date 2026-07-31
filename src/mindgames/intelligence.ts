/**
 * Mind Cascade's learner model is intentionally small, local, and explainable.
 * It describes play patterns inside this game; it never claims to measure a
 * player's general intelligence.
 */

export const MIND_DIFFICULTIES = [1, 2, 3, 4, 5] as const;
export type MindDifficulty = (typeof MIND_DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<MindDifficulty, string> = {
  1: 'Discover',
  2: 'Reason',
  3: 'Plan',
  4: 'Master',
  5: 'Synthesize',
};

export const DAILY_CHALLENGE_RULESET_VERSION = 'mind-cascade-daily-v1';
export const MAX_ADAPTIVE_SESSIONS = 6;
export const MAX_PROFILE_SESSIONS = 24;

export interface MindCascadePerformance {
  sessionId: string;
  completedAt: number;
  difficulty: MindDifficulty;
  /** Board turns committed by the player. */
  moves: number;
  /** Legal swaps that changed the board and advanced play. */
  successfulSwaps: number;
  /** Attempts rejected by the rules engine. */
  invalidSwaps: number;
  /** Legal swaps that produced no match, objective progress, or setup value. */
  wastedSwaps: number;
  objectivesCompleted: number;
  objectiveTarget: number;
  turnsUsed: number;
  /** Optional puzzle move allowance. This is a resource, never a countdown. */
  turnBudget?: number;
  maxCascadeDepth: number;
  cascadeDepthTotal: number;
  cascadesResolved: number;
  hintsUsed: number;
  forecastsUsed: number;
  /** Sum of observed thinking intervals; no real-time pressure is attached. */
  planningTimeMs: number;
  planningSamples: number;
  completed: boolean;
}

export interface MindCascadeSessionTelemetry {
  sessionId: string;
  completedAt: number;
  difficulty: MindDifficulty;
  state: Pick<
    MindGameState,
    'status' | 'turn' | 'movesRemaining' | 'config' | 'objectives' | 'history'
  >;
  invalidSwaps: number;
  wastedSwaps: number;
  hintsUsed: number;
  forecastsUsed: number;
  planningTimeMs: number;
  planningSamples: number;
  /** Explicitly false for an abandoned/in-progress board. */
  completed?: boolean;
}

export type PerformanceSignalId =
  | 'planning'
  | 'swap-precision'
  | 'objective-efficiency'
  | 'cascade-vision'
  | 'independent-reasoning';

export type SignalImpact = 'supports-harder' | 'supports-easier' | 'steady';

export interface PerformanceSignal {
  id: PerformanceSignalId;
  label: string;
  /** A bounded 0–100 game-skill score, not an IQ or intelligence score. */
  score: number;
  evidenceCount: number;
  evidence: string;
  impact: SignalImpact;
}

export interface SessionAnalysis {
  sessionId: string;
  overallScore: number;
  signals: Record<PerformanceSignalId, PerformanceSignal>;
}

export interface DifficultyRecommendation {
  current: MindDifficulty;
  recommended: MindDifficulty;
  direction: 'increase' | 'decrease' | 'maintain';
  label: string;
  score: number;
  /** Confidence percentage from 0–100. */
  confidence: number;
  sessionsAnalyzed: number;
  signals: PerformanceSignal[];
  reasons: string[];
  /**
   * Always displayed near the recommendation so players know this is a
   * reversible suggestion rather than a hidden automatic judgement.
   */
  explanation: string;
}

export type CoachingTone = 'celebrate' | 'experiment' | 'reflect';

export interface CoachingMessage {
  id: string;
  signal: PerformanceSignalId;
  tone: CoachingTone;
  title: string;
  message: string;
  evidence: string;
  nextAction: string;
}

export type CognitionSkillId =
  | 'deliberate-planning'
  | 'move-precision'
  | 'objective-efficiency'
  | 'cascade-vision'
  | 'independent-reasoning';

export interface CognitionSkill {
  id: CognitionSkillId;
  label: string;
  score: number;
  /** Confidence percentage from 0–100. */
  confidence: number;
  evidenceCount: number;
  evidence: string[];
}

export interface CognitionSkillProfile {
  generatedAt: number;
  sessionsAnalyzed: number;
  skills: CognitionSkill[];
  strongestSkill: CognitionSkillId | null;
  growthFocus: CognitionSkillId | null;
  disclaimer: string;
}

export interface DailyChallengeDescriptor {
  id: string;
  dateKey: string;
  seed: number;
  difficulty: MindDifficulty;
  rulesetVersion: typeof DAILY_CHALLENGE_RULESET_VERSION;
}

const SIGNAL_LABELS: Record<PerformanceSignalId, string> = {
  planning: 'Planning rhythm',
  'swap-precision': 'Move precision',
  'objective-efficiency': 'Objective efficiency',
  'cascade-vision': 'Cascade vision',
  'independent-reasoning': 'Independent reasoning',
};

const SIGNAL_WEIGHTS: Record<PerformanceSignalId, number> = {
  planning: 0.1,
  'swap-precision': 0.25,
  'objective-efficiency': 0.35,
  'cascade-vision': 0.15,
  'independent-reasoning': 0.15,
};

const SIGNAL_ORDER = Object.keys(SIGNAL_WEIGHTS) as PerformanceSignalId[];

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function rounded(value: number): number {
  return Math.round(clamp(value) * 100);
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function milliseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function impactFor(score: number): SignalImpact {
  if (score >= 76) return 'supports-harder';
  if (score < 43) return 'supports-easier';
  return 'steady';
}

function planningFluency(averageMs: number, precision: number): number {
  const seconds = averageMs / 1_000;
  let rhythm: number;
  // Fast guesses and long reflection are both treated as useful evidence, not
  // as moral judgements. The broad middle band reflects fluent deliberation.
  if (seconds < 1) rhythm = 0.38;
  else if (seconds < 4) rhythm = 0.72;
  else if (seconds <= 18) rhythm = 1;
  else if (seconds <= 35) rhythm = 0.78;
  else rhythm = 0.58;
  if (seconds < 4 && precision < 0.7) rhythm -= 0.2;
  return clamp(rhythm);
}

function normalisedPerformance(performance: MindCascadePerformance) {
  const successful = count(performance.successfulSwaps);
  const invalid = count(performance.invalidSwaps);
  const wasted = count(performance.wastedSwaps);
  const attempts = successful + invalid + wasted;
  const swapPrecision = attempts > 0 ? successful / attempts : 0.5;

  const objectiveTarget = count(performance.objectiveTarget);
  const objectivesCompleted = Math.min(
    count(performance.objectivesCompleted),
    Math.max(0, objectiveTarget),
  );
  const completionRatio = objectiveTarget > 0
    ? objectivesCompleted / objectiveTarget
    : 0.5;
  const turnsUsed = count(performance.turnsUsed);
  const turnBudget = performance.turnBudget === undefined
    ? null
    : Math.max(1, count(performance.turnBudget));
  const expectedPace = turnBudget && objectiveTarget > 0
    ? objectiveTarget / turnBudget
    : null;
  const actualPace = turnsUsed > 0 ? objectivesCompleted / turnsUsed : 0;
  const paceRatio = expectedPace && expectedPace > 0
    ? clamp(actualPace / expectedPace)
    : completionRatio;
  const objectiveEfficiency = clamp(completionRatio * 0.7 + paceRatio * 0.3);

  const cascades = count(performance.cascadesResolved);
  const averageCascade = cascades > 0
    ? Math.max(0, performance.cascadeDepthTotal) / cascades
    : 0;
  const maxCascade = count(performance.maxCascadeDepth);
  const cascadeVision = cascades > 0
    ? clamp(clamp(maxCascade / 5) * 0.6 + clamp(averageCascade / 3.5) * 0.4)
    : 0.35;

  const moves = count(performance.moves);
  const moveDenominator = Math.max(1, moves);
  const supportWeight = count(performance.hintsUsed)
    + count(performance.forecastsUsed) * 0.5;
  const independence = moves > 0
    ? clamp(1 - supportWeight / moveDenominator)
    : 0.5;

  const planningSamples = count(performance.planningSamples);
  const averagePlanningMs = planningSamples > 0
    ? milliseconds(performance.planningTimeMs) / planningSamples
    : 0;
  const planning = planningSamples > 0
    ? planningFluency(averagePlanningMs, swapPrecision)
    : 0.5;

  return {
    successful,
    invalid,
    wasted,
    attempts,
    swapPrecision,
    objectiveTarget,
    objectivesCompleted,
    completionRatio,
    turnsUsed,
    turnBudget,
    objectiveEfficiency,
    cascades,
    averageCascade,
    maxCascade,
    cascadeVision,
    moves,
    hints: count(performance.hintsUsed),
    forecasts: count(performance.forecastsUsed),
    independence,
    planningSamples,
    averagePlanningMs,
    planning,
  };
}

/**
 * Build the learner record directly from deterministic engine history plus the
 * few UI observations the pure engine cannot know (invalid attempts, support
 * use, and optional planning intervals).
 */
export function mindCascadePerformanceFromState(
  telemetry: MindCascadeSessionTelemetry,
): MindCascadePerformance {
  const acceptedSwaps = count(telemetry.state.history.length);
  const wastedSwaps = Math.min(acceptedSwaps, count(telemetry.wastedSwaps));
  const cascadeDepths = telemetry.state.history.map(
    (record) => count(record.cascades.length),
  );
  return {
    sessionId: telemetry.sessionId,
    completedAt: telemetry.completedAt,
    difficulty: telemetry.difficulty,
    moves: acceptedSwaps,
    successfulSwaps: Math.max(0, acceptedSwaps - wastedSwaps),
    invalidSwaps: count(telemetry.invalidSwaps),
    wastedSwaps,
    objectivesCompleted: telemetry.state.objectives.filter(
      (objective) => objective.completed,
    ).length,
    objectiveTarget: telemetry.state.objectives.length,
    turnsUsed: Math.max(
      acceptedSwaps,
      count(telemetry.state.config.moves - telemetry.state.movesRemaining),
    ),
    turnBudget: count(telemetry.state.config.moves),
    maxCascadeDepth: cascadeDepths.length > 0 ? Math.max(...cascadeDepths) : 0,
    cascadeDepthTotal: cascadeDepths.reduce((sum, depth) => sum + depth, 0),
    cascadesResolved: cascadeDepths.filter((depth) => depth > 0).length,
    hintsUsed: count(telemetry.hintsUsed),
    forecastsUsed: count(telemetry.forecastsUsed),
    planningTimeMs: milliseconds(telemetry.planningTimeMs),
    planningSamples: count(telemetry.planningSamples),
    completed: telemetry.completed ?? telemetry.state.status !== 'playing',
  };
}

/** Convert one completed session into inspectable, human-readable evidence. */
export function analyzeMindCascadeSession(
  performance: MindCascadePerformance,
): SessionAnalysis {
  const values = normalisedPerformance(performance);

  const signal = (
    id: PerformanceSignalId,
    rawScore: number,
    evidenceCount: number,
    evidence: string,
  ): PerformanceSignal => {
    const score = rounded(rawScore);
    return {
      id,
      label: SIGNAL_LABELS[id],
      score,
      evidenceCount,
      evidence,
      impact: impactFor(score),
    };
  };

  const signals: Record<PerformanceSignalId, PerformanceSignal> = {
    planning: signal(
      'planning',
      values.planning,
      values.planningSamples,
      values.planningSamples > 0
        ? `${values.planningSamples} observed decisions averaged ${formatNumber(values.averagePlanningMs / 1_000, 1)} seconds.`
        : 'No planning intervals were recorded in this session.',
    ),
    'swap-precision': signal(
      'swap-precision',
      values.swapPrecision,
      values.attempts,
      `${values.successful} productive, ${values.invalid} invalid, and ${values.wasted} unproductive swaps across ${values.attempts} attempts.`,
    ),
    'objective-efficiency': signal(
      'objective-efficiency',
      values.objectiveEfficiency,
      values.objectiveTarget > 0 ? values.turnsUsed : 0,
      `${values.objectivesCompleted} of ${values.objectiveTarget} objectives completed in ${values.turnsUsed} turns${
        values.turnBudget ? ` from a ${values.turnBudget}-turn move allowance` : ''
      }.`,
    ),
    'cascade-vision': signal(
      'cascade-vision',
      values.cascadeVision,
      values.moves > 0 ? Math.max(1, values.cascades) : 0,
      values.cascades > 0
        ? `${values.cascades} cascades averaged ${formatNumber(values.averageCascade, 1)} links; the deepest reached ${values.maxCascade}.`
        : 'No resolved cascade was recorded in this session.',
    ),
    'independent-reasoning': signal(
      'independent-reasoning',
      values.independence,
      values.moves,
      `${values.hints} hints and ${values.forecasts} forecasts were used across ${values.moves} moves.`,
    ),
  };

  const overallScore = Math.round(SIGNAL_ORDER.reduce(
    (total, id) => total + signals[id].score * SIGNAL_WEIGHTS[id],
    0,
  ));
  return { sessionId: performance.sessionId, overallScore, signals };
}

function weightedSignalAverage(
  analyses: SessionAnalysis[],
  id: PerformanceSignalId,
): PerformanceSignal {
  const relevant = analyses
    .map((analysis) => analysis.signals[id])
    .filter((signal) => signal.evidenceCount > 0);
  if (relevant.length === 0) {
    return {
      id,
      label: SIGNAL_LABELS[id],
      score: 50,
      evidenceCount: 0,
      evidence: 'No evidence has been recorded for this signal yet.',
      impact: 'steady',
    };
  }

  const evidenceCount = relevant.reduce((sum, item) => sum + item.evidenceCount, 0);
  const weightedScore = relevant.reduce(
    (sum, item) => sum + item.score * item.evidenceCount,
    0,
  ) / evidenceCount;
  const score = Math.round(weightedScore);
  return {
    id,
    label: SIGNAL_LABELS[id],
    score,
    evidenceCount,
    evidence: `${relevant.length} session${relevant.length === 1 ? '' : 's'} contributed ${evidenceCount} recorded observations; average signal score ${score}/100.`,
    impact: impactFor(score),
  };
}

function validHistory(history: readonly MindCascadePerformance[], max: number) {
  return history
    .filter((session) => session.completed && session.sessionId.trim().length > 0)
    .slice()
    .sort((a, b) => b.completedAt - a.completedAt || a.sessionId.localeCompare(b.sessionId))
    .slice(0, max);
}

/**
 * Recommend at most one difficulty step between sessions. Two sessions are
 * required before changing level, and the player remains free to ignore it.
 */
export function recommendMindCascadeDifficulty(
  history: readonly MindCascadePerformance[],
  current: MindDifficulty,
): DifficultyRecommendation {
  const sessions = validHistory(history, MAX_ADAPTIVE_SESSIONS);
  const analyses = sessions.map(analyzeMindCascadeSession);
  const signals = SIGNAL_ORDER.map((id) => weightedSignalAverage(analyses, id));
  const score = Math.round(signals.reduce(
    (sum, signal) => sum + signal.score * SIGNAL_WEIGHTS[signal.id],
    0,
  ));
  const totalMoves = sessions.reduce((sum, session) => sum + count(session.moves), 0);
  const confidenceFraction = clamp(
    Math.min(1, sessions.length / 5) * 0.7
      + Math.min(1, totalMoves / 80) * 0.3,
  );
  const confidence = rounded(confidenceFraction);

  let recommended = current;
  if (sessions.length >= 2 && confidence >= 35) {
    if (score >= 77 && current < 5) recommended = (current + 1) as MindDifficulty;
    if (score < 43 && current > 1) recommended = (current - 1) as MindDifficulty;
  }
  const direction = recommended > current
    ? 'increase'
    : recommended < current
      ? 'decrease'
      : 'maintain';

  const ranked = signals.slice().sort((a, b) => {
    const distance = (signal: PerformanceSignal) => Math.abs(signal.score - 50)
      * SIGNAL_WEIGHTS[signal.id];
    return distance(b) - distance(a) || a.id.localeCompare(b.id);
  });
  const reasons = ranked.slice(0, 3).map((signal) =>
    `${signal.label}: ${signal.score}/100 from ${signal.evidenceCount} recorded observations.`,
  );

  const label = direction === 'increase'
    ? `Try ${DIFFICULTY_LABELS[recommended]} next`
    : direction === 'decrease'
      ? `Reinforce at ${DIFFICULTY_LABELS[recommended]}`
      : `Continue at ${DIFFICULTY_LABELS[current]}`;

  return {
    current,
    recommended,
    direction,
    label,
    score,
    confidence,
    sessionsAnalyzed: sessions.length,
    signals,
    reasons,
    explanation: sessions.length < 2
      ? 'Play at least two complete sessions before the game suggests a change. Your current choice remains unchanged.'
      : `This reversible suggestion uses your last ${sessions.length} completed sessions: objective efficiency 35%, move precision 25%, cascade vision 15%, support use 15%, and planning rhythm 10%. It never adds a countdown or changes difficulty mid-session.`,
  };
}

/** Produce deterministic, evidence-backed coaching without generic judgement. */
export function createMindCascadeCoaching(
  performance: MindCascadePerformance,
  limit = 4,
): CoachingMessage[] {
  const values = normalisedPerformance(performance);
  const messages: CoachingMessage[] = [];

  if (values.attempts > 0) {
    const errorRate = (values.invalid + values.wasted) / values.attempts;
    messages.push(errorRate <= 0.12
      ? {
          id: `${performance.sessionId}:precision-strength`,
          signal: 'swap-precision',
          tone: 'celebrate',
          title: 'Your swaps stayed purposeful',
          message: `${values.successful} of ${values.attempts} attempts advanced the position.`,
          evidence: `${values.invalid} invalid and ${values.wasted} unproductive swaps were recorded.`,
          nextAction: 'Before the next swap, also scan the landing spaces for a second-stage cascade.',
        }
      : {
          id: `${performance.sessionId}:precision-focus`,
          signal: 'swap-precision',
          tone: 'experiment',
          title: 'Verify the first consequence',
          message: `${values.invalid + values.wasted} of ${values.attempts} attempts did not advance the board.`,
          evidence: `${values.invalid} were invalid; ${values.wasted} were legal but did not create progress.`,
          nextAction: 'Trace the two swapped paths once before committing, then name the match or setup each creates.',
        });
  }

  if (values.objectiveTarget > 0) {
    messages.push(values.completionRatio >= 1
      ? {
          id: `${performance.sessionId}:objective-complete`,
          signal: 'objective-efficiency',
          tone: 'celebrate',
          title: 'The objective plan held together',
          message: `You completed all ${values.objectiveTarget} objectives in ${values.turnsUsed} turns.`,
          evidence: values.turnBudget
            ? `${Math.max(0, values.turnBudget - values.turnsUsed)} moves remained in the allowance.`
            : `${values.turnsUsed} committed turns were recorded.`,
          nextAction: 'Replay the earliest turn and look for a different route to the same objective.',
        }
      : {
          id: `${performance.sessionId}:objective-focus`,
          signal: 'objective-efficiency',
          tone: 'reflect',
          title: 'Choose an objective anchor',
          message: `${values.objectivesCompleted} of ${values.objectiveTarget} objectives were completed in ${values.turnsUsed} turns.`,
          evidence: `${values.objectiveTarget - values.objectivesCompleted} objectives remained at session end.`,
          nextAction: 'Choose the scarcest objective first and reject swaps that serve neither it nor a clear setup.',
        });
  }

  if (values.cascades > 0) {
    messages.push({
      id: `${performance.sessionId}:cascade`,
      signal: 'cascade-vision',
      tone: values.maxCascade >= 4 ? 'celebrate' : 'experiment',
      title: values.maxCascade >= 4 ? 'You built a deep cascade' : 'Look one fall beyond the match',
      message: `Your deepest cascade reached ${values.maxCascade}, with a ${formatNumber(values.averageCascade, 1)}-link average.`,
      evidence: `${values.cascades} resolved cascades were measured.`,
      nextAction: values.maxCascade >= 4
        ? 'In replay, identify which earlier setup made that chain possible.'
        : 'Forecast the refill lane above a match and search for one follow-on alignment.',
    });
  }

  if (values.hints + values.forecasts > 0) {
    messages.push({
      id: `${performance.sessionId}:support`,
      signal: 'independent-reasoning',
      tone: 'reflect',
      title: 'Turn support into a reusable rule',
      message: `You consulted ${values.hints} hints and ${values.forecasts} forecasts across ${values.moves} moves.`,
      evidence: `Support tools appeared on ${formatNumber(((values.hints + values.forecasts) / Math.max(1, values.moves)) * 100)}% of recorded moves at most.`,
      nextAction: 'After opening support, explain why its move works before you play it; the explanation is the transferable skill.',
    });
  } else if (values.moves >= 5) {
    messages.push({
      id: `${performance.sessionId}:independence`,
      signal: 'independent-reasoning',
      tone: 'celebrate',
      title: 'You tested your own model',
      message: `All ${values.moves} recorded moves were made without a hint or forecast.`,
      evidence: 'The session recorded zero hint and forecast uses.',
      nextAction: 'Use replay to compare one of your predictions with the cascade that actually followed.',
    });
  }

  if (values.planningSamples > 0) {
    const seconds = values.averagePlanningMs / 1_000;
    messages.push({
      id: `${performance.sessionId}:planning`,
      signal: 'planning',
      tone: seconds < 4 && values.swapPrecision < 0.7 ? 'experiment' : 'reflect',
      title: seconds < 4 && values.swapPrecision < 0.7
        ? 'Add a brief forecast before committing'
        : 'Keep a planning rhythm that supports accuracy',
      message: `${values.planningSamples} decisions averaged ${formatNumber(seconds, 1)} seconds, alongside ${formatNumber(values.swapPrecision * 100)}% productive swaps.`,
      evidence: `Planning intervals were observed for ${values.planningSamples} decisions; there is no countdown.`,
      nextAction: seconds < 4 && values.swapPrecision < 0.7
        ? 'Pause to name the immediate match and one likely refill consequence.'
        : 'Keep using the amount of reflection you need; accuracy and explanation matter more than speed.',
    });
  }

  return messages
    .slice()
    .sort((a, b) => {
      const priority = (message: CoachingMessage) =>
        message.tone === 'experiment' ? 0 : message.tone === 'reflect' ? 1 : 2;
      return priority(a) - priority(b);
    })
    .slice(0, Math.max(0, Math.floor(limit)));
}

/** Build a confidence-labelled profile from completed local sessions. */
export function buildMindCascadeSkillProfile(
  history: readonly MindCascadePerformance[],
  generatedAt = Date.now(),
): CognitionSkillProfile {
  const sessions = validHistory(history, MAX_PROFILE_SESSIONS);
  const analyses = sessions.map(analyzeMindCascadeSession);
  const bySignal = new Map(
    SIGNAL_ORDER.map((id) => [id, weightedSignalAverage(analyses, id)]),
  );

  const makeSkill = (
    id: CognitionSkillId,
    signalId: PerformanceSignalId,
  ): CognitionSkill => {
    const signal = bySignal.get(signalId)!;
    const contributingSessions = analyses.filter(
      (analysis) => analysis.signals[signalId].evidenceCount > 0,
    );
    const confidence = rounded(
      Math.min(1, contributingSessions.length / 8) * 0.65
        + Math.min(1, signal.evidenceCount / 80) * 0.35,
    );
    return {
      id,
      label: SIGNAL_LABELS[signalId],
      score: signal.score,
      confidence,
      evidenceCount: signal.evidenceCount,
      evidence: contributingSessions.slice(0, 3).map(
        (analysis) => analysis.signals[signalId].evidence,
      ),
    };
  };

  const skills = [
    makeSkill('deliberate-planning', 'planning'),
    makeSkill('move-precision', 'swap-precision'),
    makeSkill('objective-efficiency', 'objective-efficiency'),
    makeSkill('cascade-vision', 'cascade-vision'),
    makeSkill('independent-reasoning', 'independent-reasoning'),
  ];
  const eligible = skills.filter((skill) => skill.evidenceCount > 0);
  const strongestSkill = eligible.length > 0
    ? eligible.slice().sort((a, b) => b.score - a.score || b.confidence - a.confidence)[0].id
    : null;
  const growthFocus = eligible.length > 0
    ? eligible.slice().sort((a, b) => a.score - b.score || b.confidence - a.confidence)[0].id
    : null;

  return {
    generatedAt,
    sessionsAnalyzed: sessions.length,
    skills,
    strongestSkill,
    growthFocus,
    disclaimer: 'This profile summarizes observed Mind Cascade play patterns. It is not an intelligence, aptitude, or clinical assessment, and every score shows its evidence and confidence.',
  };
}

/** Return a local calendar key so a player's challenge changes at local midnight. */
export function mindCascadeDateKey(date: Date | string = new Date()): string {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new Error('Daily challenge dates must use YYYY-MM-DD.');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const verified = new Date(Date.UTC(year, month - 1, day));
    if (
      verified.getUTCFullYear() !== year
      || verified.getUTCMonth() !== month - 1
      || verified.getUTCDate() !== day
    ) throw new Error('Daily challenge date is not a real calendar date.');
    return date;
  }
  if (Number.isNaN(date.getTime())) throw new Error('Daily challenge date is invalid.');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Stable FNV-1a seed: same local date and ruleset always create the same board. */
export function mindCascadeDailySeed(date: Date | string = new Date()): number {
  const source = `${DAILY_CHALLENGE_RULESET_VERSION}:${mindCascadeDateKey(date)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

export function getMindCascadeDailyChallenge(
  date: Date | string = new Date(),
): DailyChallengeDescriptor {
  const dateKey = mindCascadeDateKey(date);
  const seed = mindCascadeDailySeed(dateKey);
  // Daily boards rotate through levels 2–4. Level 1 remains onboarding and
  // level 5 remains an explicit mastery choice.
  const difficulty = (2 + (seed % 3)) as MindDifficulty;
  return {
    id: `daily:${dateKey}:${DAILY_CHALLENGE_RULESET_VERSION}`,
    dateKey,
    seed,
    difficulty,
    rulesetVersion: DAILY_CHALLENGE_RULESET_VERSION,
  };
}
import type { MindGameState } from './engine';
