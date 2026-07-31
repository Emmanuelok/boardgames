import {
  type CSSProperties,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ENGINE_VERSION,
  MIND_GAME_LEVELS,
  analyzeMoves,
  applyMove,
  createGame,
  getLevel,
  isAdjacent,
  replayGame,
  seedFromString,
  stateFingerprint,
  type GameConfig,
  type MindGameState,
  type MoveAnalysis,
  type ObjectiveProgress,
  type Position,
  type ReplayBundle,
  type TileKind,
} from '../mindgames/engine';
import {
  DIFFICULTY_LABELS,
  MIND_DIFFICULTIES,
  createMindCascadeCoaching,
  getMindCascadeDailyChallenge,
  mindCascadePerformanceFromState,
  recommendMindCascadeDifficulty,
  type DifficultyRecommendation,
  type MindCascadePerformance,
  type MindDifficulty,
} from '../mindgames/intelligence';
import {
  MIND_CASCADE_ACHIEVEMENTS,
  completeMindCascadeSession,
  createMindCascadeProgressRepository,
  createResumableMindCascadeSession,
  mindCascadeReplayStepsFromEngine,
  withResumableMindCascadeSession,
  withoutResumableMindCascadeSession,
  type MindCascadeMode,
  type MindCascadeProgress,
  type MindCascadeProgressRepository,
  type MindCascadeReplay,
  type MindCascadeSessionObservations,
  type ResumableMindCascadeSession,
} from '../mindgames/progress';
import './MindCascade.css';

type RouteMode = 'classic' | 'daily' | 'resume';
type CoachTab = 'forecast' | 'coach' | 'objectives';

interface DifficultyOption {
  difficulty: MindDifficulty;
  levelId: string;
  focus: string;
}

interface RuntimeSession {
  id: string;
  mode: MindCascadeMode;
  difficulty: MindDifficulty;
  startedAt: number;
  dailyChallengeId?: string;
  game: MindGameState;
  invalidSwaps: number;
  wastedSwaps: number;
  hintsUsed: number;
  forecastsUsed: number;
  planningTimeMs: number;
  planningSamples: number;
  recoveryMessage?: string;
}

interface CompletionSummary {
  performance: MindCascadePerformance;
  recommendation: DifficultyRecommendation;
  unlockedAchievementIds: string[];
}

const DIFFICULTY_OPTIONS: readonly DifficultyOption[] = [
  { difficulty: 1, levelId: 'pattern-garden', focus: 'Learn the visual grammar with a generous allowance.' },
  { difficulty: 2, levelId: 'pattern-garden', focus: 'Prioritise two collections and marked coordinates.' },
  { difficulty: 3, levelId: 'cascade-atlas', focus: 'Construct deeper cascades and four-tile formations.' },
  { difficulty: 4, levelId: 'symmetry-workshop', focus: 'Plan with Mirror and Orbit spatial effects.' },
  { difficulty: 5, levelId: 'architects-trial', focus: 'Balance four linked objectives on one board.' },
] as const;

const TILE_PRESENTATION: Record<TileKind, {
  label: string;
  glyph: string;
  pattern: string;
  hue: number;
}> = {
  ember: { label: 'Ember triangle', glyph: '△', pattern: 'lines', hue: 8 },
  tide: { label: 'Tide wave', glyph: '≈', pattern: 'dots', hue: 192 },
  grove: { label: 'Grove diamond', glyph: '◇', pattern: 'rings', hue: 142 },
  dawn: { label: 'Dawn star', glyph: '✦', pattern: 'cross', hue: 43 },
  iris: { label: 'Iris lens', glyph: '◉', pattern: 'grid', hue: 272 },
  slate: { label: 'Slate hexagon', glyph: '⬡', pattern: 'slash', hue: 218 },
};

const OBJECTIVE_COLORS = ['#70e6c7', '#61def0', '#9b87ff', '#f4ca78'] as const;

function optionForDifficulty(difficulty: MindDifficulty): DifficultyOption {
  return DIFFICULTY_OPTIONS.find((option) => option.difficulty === difficulty)
    ?? DIFFICULTY_OPTIONS[1];
}

function levelForDifficulty(difficulty: MindDifficulty) {
  return getLevel(optionForDifficulty(difficulty).levelId) ?? MIND_GAME_LEVELS[0];
}

function createDifficultyGame(
  difficulty: MindDifficulty,
  seed: number | string,
): MindGameState {
  const level = levelForDifficulty(difficulty);
  const moves = difficulty === 1
    ? level.config.moves + 6
    : difficulty === 2
      ? level.config.moves + 2
      : level.config.moves;
  return createGame({
    seed,
    levelId: level.id,
    config: { moves },
  });
}

function positionLabel(position: Position): string {
  return `${String.fromCharCode(65 + position.column)}${position.row + 1}`;
}

function samePosition(first: Position | null, second: Position): boolean {
  return Boolean(first && first.row === second.row && first.column === second.column);
}

function objectiveTarget(objective: ObjectiveProgress): number {
  return objective.spec.type === 'cascade'
    ? objective.spec.targetDepth
    : objective.spec.target;
}

function objectiveCopy(objective: ObjectiveProgress): {
  icon: string;
  label: string;
  guide: string;
} {
  const { spec } = objective;
  if (spec.type === 'collect') {
    const tile = TILE_PRESENTATION[spec.kind];
    return {
      icon: tile.glyph,
      label: `Collect ${spec.target} ${tile.label.toLowerCase()} tiles`,
      guide: `Create matches containing ${tile.label.toLowerCase()} tiles. Cascades count too.`,
    };
  }
  if (spec.type === 'cascade') {
    return {
      icon: '⌁',
      label: `Reach a ${spec.targetDepth}-step cascade`,
      guide: 'Prepare a second alignment above or beside the first match so gravity continues the sequence.',
    };
  }
  if (spec.type === 'formation') {
    return spec.formation === 'intersection'
      ? {
          icon: '⌬',
          label: `Create ${spec.target} intersection${spec.target === 1 ? '' : 's'}`,
          guide: 'Cross a horizontal and vertical match at one shared tile to create an Orbit.',
        }
      : {
          icon: '↔',
          label: `Create ${spec.target} line-four${spec.target === 1 ? '' : 's'}`,
          guide: 'Align four matching tiles to create a Mirror with a reflected board effect.',
        };
  }
  return {
    icon: '⌑',
    label: `Clear ${spec.target} marked coordinates`,
    guide: 'Include gold-dashed coordinates in a match or the reach of a spatial special.',
  };
}

function modeLabel(mode: MindCascadeMode): string {
  if (mode === 'daily') return 'Daily shared seed';
  if (mode === 'practice') return 'Practice board';
  if (mode === 'journey') return 'Designed path';
  return 'Designed path';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuild saved play from its original seed and verified turn hashes. The
 * serialized board is never treated as authoritative on its own.
 */
function restoreVerifiedGame(
  resumable: ResumableMindCascadeSession,
): MindGameState | null {
  try {
    const raw = resumable.state;
    if (!isRecord(raw) || raw.version !== ENGINE_VERSION || !isRecord(raw.config)) return null;
    if (!Array.isArray(raw.history)) return null;
    const moves: ReplayBundle['moves'] = raw.history.map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.swap)) throw new Error('Missing replay swap.');
      const from = entry.swap.from;
      const to = entry.swap.to;
      if (!isRecord(from) || !isRecord(to)) throw new Error('Invalid replay coordinate.');
      if (
        typeof from.row !== 'number'
        || typeof from.column !== 'number'
        || typeof to.row !== 'number'
        || typeof to.column !== 'number'
      ) throw new Error('Invalid replay coordinate.');
      return {
        from: { row: from.row, column: from.column },
        to: { row: to.row, column: to.column },
      };
    });
    const fingerprints = raw.history.map((entry) => {
      if (!isRecord(entry) || typeof entry.afterHash !== 'string') {
        throw new Error('Missing replay fingerprint.');
      }
      return entry.afterHash;
    });
    const game = replayGame({
      version: ENGINE_VERSION,
      seed: resumable.seed,
      config: raw.config as unknown as GameConfig,
      moves,
      fingerprints,
    });
    if (game.turn !== resumable.moveNumber || game.score !== resumable.score) return null;
    return game;
  } catch {
    return null;
  }
}

function createFreshRuntime(
  difficulty: MindDifficulty,
  mode: MindCascadeMode,
  seed: number | string,
  now: number,
  dailyChallengeId?: string,
): RuntimeSession {
  const game = createDifficultyGame(difficulty, seed);
  const id = dailyChallengeId
    ? `mind-cascade:${dailyChallengeId}`
    : `mind-cascade:${mode}:${game.seed}:${now}`;
  return {
    id,
    mode,
    difficulty,
    startedAt: now,
    ...(dailyChallengeId ? { dailyChallengeId } : {}),
    game,
    invalidSwaps: 0,
    wastedSwaps: 0,
    hintsUsed: 0,
    forecastsUsed: 0,
    planningTimeMs: 0,
    planningSamples: 0,
  };
}

function initializeRuntime(
  routeMode: RouteMode,
  progress: MindCascadeProgress,
  now = Date.now(),
): RuntimeSession {
  const daily = getMindCascadeDailyChallenge();
  if (routeMode === 'resume' && progress.resumableSession) {
    const restored = restoreVerifiedGame(progress.resumableSession);
    if (restored) {
      const observations = progress.resumableSession.observations;
      return {
        id: progress.resumableSession.id,
        mode: progress.resumableSession.mode,
        difficulty: progress.resumableSession.difficulty,
        startedAt: progress.resumableSession.startedAt,
        ...(progress.resumableSession.dailyChallengeId
          ? { dailyChallengeId: progress.resumableSession.dailyChallengeId }
          : {}),
        game: restored,
        invalidSwaps: observations?.invalidSwaps ?? 0,
        wastedSwaps: observations?.wastedSwaps ?? 0,
        hintsUsed: observations?.hintsUsed ?? 0,
        forecastsUsed: observations?.forecastsUsed ?? 0,
        planningTimeMs: observations?.planningTimeMs ?? 0,
        planningSamples: observations?.planningSamples ?? 0,
      };
    }
    return {
      ...createFreshRuntime(
        progress.selectedDifficulty,
        'classic',
        seedFromString(`mind-cascade:recovery:${now}`),
        now,
      ),
      recoveryMessage: 'The saved board could not be verified, so a clean board was opened. The unreadable save was not used.',
    };
  }
  if (routeMode === 'daily') {
    const savedDaily = progress.resumableSession?.dailyChallengeId === daily.id
      ? restoreVerifiedGame(progress.resumableSession)
      : null;
    if (savedDaily && progress.resumableSession) {
      const observations = progress.resumableSession.observations;
      return {
        id: progress.resumableSession.id,
        mode: 'daily',
        difficulty: daily.difficulty,
        startedAt: progress.resumableSession.startedAt,
        dailyChallengeId: daily.id,
        game: savedDaily,
        invalidSwaps: observations?.invalidSwaps ?? 0,
        wastedSwaps: observations?.wastedSwaps ?? 0,
        hintsUsed: observations?.hintsUsed ?? 0,
        forecastsUsed: observations?.forecastsUsed ?? 0,
        planningTimeMs: observations?.planningTimeMs ?? 0,
        planningSamples: observations?.planningSamples ?? 0,
      };
    }
    return createFreshRuntime(
      daily.difficulty,
      'daily',
      daily.seed,
      now,
      daily.id,
    );
  }
  return createFreshRuntime(
    progress.selectedDifficulty,
    'classic',
    seedFromString(`mind-cascade:session:${now}:${progress.totalCompletedSessions}`),
    now,
  );
}

function runtimePerformance(
  session: RuntimeSession,
  game: MindGameState,
  completedAt: number,
  completed = game.status !== 'playing',
): MindCascadePerformance {
  return mindCascadePerformanceFromState({
    sessionId: session.id,
    completedAt,
    difficulty: session.difficulty,
    state: game,
    invalidSwaps: session.invalidSwaps,
    wastedSwaps: session.wastedSwaps,
    hintsUsed: session.hintsUsed,
    forecastsUsed: session.forecastsUsed,
    planningTimeMs: session.planningTimeMs,
    planningSamples: session.planningSamples,
    completed,
  });
}

function runtimeObservations(
  session: RuntimeSession,
): MindCascadeSessionObservations {
  return {
    invalidSwaps: session.invalidSwaps,
    wastedSwaps: session.wastedSwaps,
    hintsUsed: session.hintsUsed,
    forecastsUsed: session.forecastsUsed,
    planningTimeMs: session.planningTimeMs,
    planningSamples: session.planningSamples,
  };
}

function replaySnapshots(game: MindGameState): MindGameState[] {
  let snapshot = createGame({ seed: game.seed, config: game.config });
  const snapshots = [snapshot];
  for (const record of game.history) {
    const next = applyMove(snapshot, record.swap);
    if (next === snapshot || stateFingerprint(next) !== record.afterHash) break;
    snapshot = next;
    snapshots.push(snapshot);
  }
  return snapshots;
}

function restoreArchivedReplay(replay: MindCascadeReplay): MindGameState | null {
  try {
    if (replay.engineVersion !== String(ENGINE_VERSION)) return null;
    const moves = replay.steps.map((step) => {
      if (!isRecord(step.action) || !isRecord(step.action.swap)) {
        throw new Error('Replay move is unavailable.');
      }
      const { from, to } = step.action.swap;
      if (!isRecord(from) || !isRecord(to)) throw new Error('Replay coordinate is unavailable.');
      if (
        typeof from.row !== 'number'
        || typeof from.column !== 'number'
        || typeof to.row !== 'number'
        || typeof to.column !== 'number'
      ) throw new Error('Replay coordinate is invalid.');
      return {
        from: { row: from.row, column: from.column },
        to: { row: to.row, column: to.column },
      };
    });
    const fingerprints = replay.steps.map((step) => {
      if (!step.boardHash) throw new Error('Replay fingerprint is unavailable.');
      return step.boardHash;
    });
    const initial = createDifficultyGame(replay.difficulty, replay.seed);
    return replayGame({
      version: ENGINE_VERSION,
      seed: replay.seed,
      config: initial.config,
      moves,
      fingerprints,
    });
  } catch {
    return null;
  }
}

function MindCascadeExperience({ routeMode }: { routeMode: RouteMode }) {
  const [repository] = useState<MindCascadeProgressRepository>(
    () => createMindCascadeProgressRepository(),
  );
  const [bootstrap] = useState(() => {
    const loaded = repository.load();
    return {
      progress: loaded.state,
      warning: loaded.warning ?? '',
      runtime: initializeRuntime(routeMode, loaded.state),
    };
  });
  const [progress, setProgress] = useState(bootstrap.progress);
  const [storageWarning, setStorageWarning] = useState(bootstrap.warning);
  const [session, setSession] = useState(bootstrap.runtime);
  const [selected, setSelected] = useState<Position | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [coachTab, setCoachTab] = useState<CoachTab>('objectives');
  const [forecast, setForecast] = useState<MoveAnalysis | null>(null);
  const [liveMessage, setLiveMessage] = useState(
    'Select a tile, then choose an adjacent tile to commit a swap.',
  );
  const [messageIsError, setMessageIsError] = useState(false);
  const [completion, setCompletion] = useState<CompletionSummary | null>(null);
  const [replayTurn, setReplayTurn] = useState(bootstrap.runtime.game.turn);
  const decisionStartedAt = useRef<number | null>(Date.now());
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const coachTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const daily = useMemo(() => getMindCascadeDailyChallenge(), []);

  const game = session.game;
  const snapshots = useMemo(() => replaySnapshots(game), [game]);
  const boundedReplayTurn = Math.min(replayTurn, snapshots.length - 1);
  const displayedGame = snapshots[boundedReplayTurn] ?? game;
  const reviewing = boundedReplayTurn < game.turn;
  const analyses = useMemo(
    () => game.status === 'playing' ? analyzeMoves(game, 5) : [],
    [game],
  );
  const currentPerformance = useMemo(
    () => runtimePerformance(session, game, Date.now(), game.status !== 'playing'),
    [game, session],
  );
  const coaching = useMemo(
    () => createMindCascadeCoaching(currentPerformance, 4),
    [currentPerformance],
  );
  const adaptive = useMemo(
    () => recommendMindCascadeDifficulty(progress.performanceHistory, session.difficulty),
    [progress.performanceHistory, session.difficulty],
  );
  const currentLevel = levelForDifficulty(session.difficulty);
  const displayedLastTurn = displayedGame.history[displayedGame.history.length - 1];
  const lastCascadeDepth = displayedLastTurn?.cascades.length ?? 0;
  const maxCascadeDepth = displayedGame.history.reduce(
    (maximum, turn) => Math.max(maximum, turn.cascades.length),
    0,
  );

  const persistResume = (nextSession: RuntimeSession) => {
    try {
      const resume = createResumableMindCascadeSession({
        id: nextSession.id,
        mode: nextSession.mode,
        difficulty: nextSession.difficulty,
        startedAt: nextSession.startedAt,
        savedAt: Date.now(),
        state: nextSession.game,
        ...(nextSession.dailyChallengeId
          ? { dailyChallengeId: nextSession.dailyChallengeId }
          : {}),
        observations: runtimeObservations(nextSession),
      });
      const saved = repository.update((current) =>
        withResumableMindCascadeSession(current, resume));
      setProgress(saved.state);
      setStorageWarning(saved.warning ?? '');
    } catch {
      setStorageWarning('This board remains playable, but the browser could not prepare a verified local resume.');
    }
  };

  const archiveCompletion = (nextSession: RuntimeSession) => {
    const completedAt = Date.now();
    const performance = runtimePerformance(nextSession, nextSession.game, completedAt, true);
    const replay: MindCascadeReplay = {
      id: `replay:${nextSession.id}`,
      sessionId: nextSession.id,
      title: `${currentLevel.name} · ${nextSession.game.status === 'won' ? 'objectives complete' : 'move allowance used'}`,
      mode: nextSession.mode,
      engineVersion: String(ENGINE_VERSION),
      seed: nextSession.game.seed,
      difficulty: nextSession.difficulty,
      startedAt: nextSession.startedAt,
      completedAt,
      outcome: nextSession.game.status === 'won' ? 'objective-complete' : 'moves-exhausted',
      score: nextSession.game.score,
      ...(nextSession.dailyChallengeId
        ? { dailyChallengeId: nextSession.dailyChallengeId }
        : {}),
      steps: mindCascadeReplayStepsFromEngine(nextSession.game.history),
      performance,
    };
    const before = new Set(repository.current().achievements.map((item) => item.id));
    try {
      const saved = repository.update((current) =>
        completeMindCascadeSession(current, {
          performance,
          replay,
          ...(nextSession.dailyChallengeId
            ? { dailyChallengeId: nextSession.dailyChallengeId }
            : {}),
        }, completedAt));
      const unlockedAchievementIds = saved.state.achievements
        .map((item) => item.id)
        .filter((id) => !before.has(id));
      setProgress(saved.state);
      setStorageWarning(saved.warning ?? '');
      setCompletion({
        performance,
        recommendation: recommendMindCascadeDifficulty(
          saved.state.performanceHistory,
          nextSession.difficulty,
        ),
        unlockedAchievementIds,
      });
    } catch {
      setStorageWarning('The completed board remains visible, but its replay could not be added to local history.');
    }
  };

  const startFresh = (
    difficulty: MindDifficulty,
    mode: MindCascadeMode = 'classic',
  ) => {
    if (
      game.status === 'playing'
      && game.turn > 0
      && typeof window !== 'undefined'
      && !window.confirm('Start a fresh board? Your current verified resume will be replaced, while completed replays remain in the archive.')
    ) return;
    const now = Date.now();
    const isDaily = mode === 'daily';
    const next = isDaily
      ? createFreshRuntime(daily.difficulty, 'daily', daily.seed, now, daily.id)
      : createFreshRuntime(
          difficulty,
          'classic',
          seedFromString(`mind-cascade:session:${now}:${progress.totalCompletedSessions}:${difficulty}`),
          now,
        );
    setSession(next);
    setSelected(null);
    setFocusIndex(0);
    setPaused(false);
    setForecast(null);
    setCompletion(null);
    setReplayTurn(0);
    setLiveMessage('Fresh board ready. Read every objective before committing the first swap.');
    setMessageIsError(false);
    decisionStartedAt.current = now;
    const saved = repository.update((current) => ({
      ...withoutResumableMindCascadeSession(current, now),
      selectedDifficulty: next.difficulty,
    }));
    setProgress(saved.state);
    setStorageWarning(saved.warning ?? '');
  };

  const commitTile = (position: Position) => {
    if (paused || reviewing || game.status !== 'playing') return;
    if (!selected) {
      setSelected(position);
      setLiveMessage(`${positionLabel(position)} selected. Choose one orthogonally adjacent tile.`);
      setMessageIsError(false);
      return;
    }
    if (samePosition(selected, position)) {
      setSelected(null);
      setLiveMessage('Selection cleared.');
      setMessageIsError(false);
      return;
    }
    if (!isAdjacent(selected, position)) {
      setSelected(position);
      setLiveMessage(`${positionLabel(position)} selected instead. Swaps must be orthogonally adjacent.`);
      setMessageIsError(false);
      return;
    }

    const nextGame = applyMove(game, { from: selected, to: position });
    if (nextGame === game) {
      const nextSession = {
        ...session,
        invalidSwaps: session.invalidSwaps + 1,
      };
      setSession(nextSession);
      if (game.turn > 0) persistResume(nextSession);
      setSelected(null);
      setLiveMessage('That adjacent swap creates no match. The move allowance was not spent.');
      setMessageIsError(true);
      return;
    }

    const now = Date.now();
    const planningInterval = decisionStartedAt.current === null
      ? 0
      : Math.max(0, Math.min(300_000, now - decisionStartedAt.current));
    const turn = nextGame.history[nextGame.history.length - 1];
    const unproductive = (turn?.scoreDelta ?? 0) <= 0;
    const nextSession: RuntimeSession = {
      ...session,
      game: nextGame,
      wastedSwaps: session.wastedSwaps + (unproductive ? 1 : 0),
      planningTimeMs: session.planningTimeMs + planningInterval,
      planningSamples: session.planningSamples + 1,
    };
    setSession(nextSession);
    setSelected(null);
    setForecast(null);
    setReplayTurn(nextGame.turn);
    decisionStartedAt.current = now;
    const depth = turn?.cascades.length ?? 0;
    const cleared = turn?.cascades.reduce((sum, step) => sum + step.cleared.length, 0) ?? 0;
    setLiveMessage(
      `${positionLabel(selected)} → ${positionLabel(position)} resolved ${depth} cascade step${depth === 1 ? '' : 's'} and cleared ${cleared} tiles.`,
    );
    setMessageIsError(false);
    if (nextGame.status === 'playing') persistResume(nextSession);
    else archiveCompletion(nextSession);
  };

  const openCoachTab = (tab: CoachTab) => {
    if (tab === coachTab) return;
    setCoachTab(tab);
    if (tab === 'forecast' && game.status === 'playing') {
      const nextSession = {
        ...session,
        forecastsUsed: session.forecastsUsed + 1,
      };
      setSession(nextSession);
      if (game.turn > 0) persistResume(nextSession);
    }
    if (tab === 'coach' && game.status === 'playing') {
      const nextSession = {
        ...session,
        hintsUsed: session.hintsUsed + 1,
      };
      setSession(nextSession);
      if (game.turn > 0) persistResume(nextSession);
    }
  };

  const chooseForecast = (analysis: MoveAnalysis) => {
    setForecast(analysis);
    setSelected(analysis.swap.from);
    const index = analysis.swap.from.row * game.config.columns + analysis.swap.from.column;
    setFocusIndex(index);
    tileRefs.current[index]?.focus();
    setLiveMessage(
      `Forecast selected ${positionLabel(analysis.swap.from)} → ${positionLabel(analysis.swap.to)}. ${analysis.reason}.`,
    );
    setMessageIsError(false);
  };

  const showReplayTurn = (turn: number) => {
    const nextTurn = Math.max(0, Math.min(game.turn, turn));
    setReplayTurn(nextTurn);
    decisionStartedAt.current = nextTurn < game.turn || paused || game.status !== 'playing'
      ? null
      : Date.now();
  };

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      decisionStartedAt.current = Date.now();
      requestAnimationFrame(() => pauseButtonRef.current?.focus());
      return;
    }
    setPaused(true);
    decisionStartedAt.current = null;
    requestAnimationFrame(() => resumeButtonRef.current?.focus());
  };

  const onCoachTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const tabs: readonly CoachTab[] = ['forecast', 'coach', 'objectives'];
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    openCoachTab(tabs[nextIndex]);
    coachTabRefs.current[nextIndex]?.focus();
  };

  const openArchivedReplay = (replay: MindCascadeReplay) => {
    if (
      game.status === 'playing'
      && game.turn > 0
      && typeof window !== 'undefined'
      && !window.confirm('Open this archived replay? Your current board remains saved and can still be resumed from the Mind Games hub.')
    ) return;
    const restored = restoreArchivedReplay(replay);
    if (!restored) {
      setLiveMessage('This archived replay could not be verified with the current engine.');
      setMessageIsError(true);
      return;
    }
    setSession({
      id: replay.sessionId,
      mode: replay.mode,
      difficulty: replay.difficulty,
      startedAt: replay.startedAt,
      ...(replay.dailyChallengeId ? { dailyChallengeId: replay.dailyChallengeId } : {}),
      game: restored,
      invalidSwaps: replay.performance.invalidSwaps,
      wastedSwaps: replay.performance.wastedSwaps,
      hintsUsed: replay.performance.hintsUsed,
      forecastsUsed: replay.performance.forecastsUsed,
      planningTimeMs: replay.performance.planningTimeMs,
      planningSamples: replay.performance.planningSamples,
    });
    setSelected(null);
    setForecast(null);
    setPaused(false);
    setCompletion({
      performance: replay.performance,
      recommendation: recommendMindCascadeDifficulty(
        progress.performanceHistory,
        replay.difficulty,
      ),
      unlockedAchievementIds: [],
    });
    setReplayTurn(0);
    decisionStartedAt.current = null;
    setLiveMessage(`Verified replay opened: ${replay.title}.`);
    setMessageIsError(false);
  };

  const onTileKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    position: Position,
  ) => {
    const { rows, columns } = displayedGame.config;
    const row = Math.floor(index / columns);
    const column = index % columns;
    let nextIndex = index;
    if (event.key === 'ArrowLeft' && column > 0) nextIndex -= 1;
    else if (event.key === 'ArrowRight' && column < columns - 1) nextIndex += 1;
    else if (event.key === 'ArrowUp' && row > 0) nextIndex -= columns;
    else if (event.key === 'ArrowDown' && row < rows - 1) nextIndex += columns;
    else if (event.key === 'Home') nextIndex = row * columns;
    else if (event.key === 'End') nextIndex = row * columns + columns - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commitTile(position);
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSelected(null);
      setLiveMessage('Selection cleared.');
      return;
    } else {
      return;
    }
    event.preventDefault();
    setFocusIndex(nextIndex);
    tileRefs.current[nextIndex]?.focus();
  };

  const progressWarning = storageWarning || session.recoveryMessage;

  return (
    <div className="mc-page">
      <header className="mc-hero">
        <div className="mc-hero-copy">
          <span className="section-overline">GrandMaster original · strategic cascade laboratory</span>
          <h1>Think beyond the match.</h1>
          <p>Mind Cascade is a deliberate pattern game: read a seeded board, compare legal swaps, satisfy linked objectives and preserve enough future structure to finish the plan.</p>
          <div className="mc-hero-actions">
            <button className="btn primary lg glow" type="button" onClick={() => startFresh(session.difficulty)}>
              New designed board
            </button>
            <Link className="btn lg" to="/mind-games">Mind Games laboratory</Link>
          </div>
          <div className="mc-hero-proof" aria-label="Mind Cascade safeguards">
            <span><i /> deterministic engine</span>
            <span><i /> no pressure timer</span>
            <span><i /> no paid lives or random rewards</span>
          </div>
        </div>
        <aside className="mc-hero-card" aria-label="Today's Mind Cascade challenge">
          <span>Today’s shared position</span>
          <strong>{DIFFICULTY_LABELS[daily.difficulty]}</strong>
          <p>One local-calendar seed, the same starting logic all day, and a replayable move record.</p>
          <div className="mc-daily-seed">
            <div><span>{daily.dateKey}</span><b>Seed {daily.seed}</b></div>
            <b>{routeMode === 'daily' ? 'Active' : 'Available'}</b>
          </div>
          {session.mode !== 'daily' ? (
            <Link className="btn" to="/mind-games/cascade?daily=1">
              Open today’s seed
            </Link>
          ) : null}
        </aside>
      </header>

      <section className="mc-level-shell" aria-labelledby="mc-level-title">
        <div className="mc-level-copy">
          <span className="section-overline">Five reasoning depths</span>
          <h2 id="mc-level-title">Choose the next board, not a hidden handicap.</h2>
          <p>Changing depth always starts a fresh session. A board never becomes harder while you are playing it.</p>
        </div>
        <div className="mc-levels" aria-label="Mind Cascade reasoning depth">
          {MIND_DIFFICULTIES.map((difficulty) => {
            const option = optionForDifficulty(difficulty);
            return (
              <button
                key={difficulty}
                type="button"
                className={session.difficulty === difficulty ? 'on' : ''}
                aria-pressed={session.difficulty === difficulty}
                onClick={() => startFresh(difficulty)}
              >
                <span>Depth {difficulty}</span>
                <strong>{DIFFICULTY_LABELS[difficulty]}</strong>
                <small>{option.focus}</small>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="mc-adaptive-note" aria-label="Adaptive difficulty recommendation">
        <span aria-hidden="true">◎</span>
        <div>
          <strong>{adaptive.label}</strong>
          <small>{adaptive.explanation} Confidence: {adaptive.confidence}% from {adaptive.sessionsAnalyzed} completed session{adaptive.sessionsAnalyzed === 1 ? '' : 's'}.</small>
        </div>
        {adaptive.recommended !== session.difficulty ? (
          <button
            className="btn"
            type="button"
            onClick={() => startFresh(adaptive.recommended)}
          >
            Use for a new board
          </button>
        ) : null}
      </aside>

      {progressWarning ? (
        <p className="mc-live-note error" role="status">{progressWarning}</p>
      ) : null}

      <section className="mc-session" aria-label="Mind Cascade play and analysis workspace">
        <div className="mc-play-card">
          <div className="mc-session-bar">
            <div>
              <span className="section-overline">{modeLabel(session.mode)} · seed {game.seed}</span>
              <h2>{currentLevel.name}</h2>
            </div>
            <div className="mc-session-actions">
              {reviewing ? (
                <button className="btn" type="button" onClick={() => showReplayTurn(game.turn)}>
                  Return to live board
                </button>
              ) : null}
              <button
                ref={pauseButtonRef}
                className="btn"
                type="button"
                aria-pressed={paused}
                onClick={togglePause}
                disabled={game.status !== 'playing' || reviewing}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button className="btn" type="button" onClick={() => startFresh(session.difficulty)}>
                Restart
              </button>
            </div>
          </div>

          <div className="mc-hud" aria-label="Session status">
            <div className="hot"><span>Moves remaining</span><strong>{displayedGame.movesRemaining}</strong><small>allowance, not a timer</small></div>
            <div><span>Score</span><strong>{displayedGame.score.toLocaleString()}</strong><small>board analysis only</small></div>
            <div><span>Cascade insight</span><strong>{lastCascadeDepth || '—'}</strong><small>deepest this session {maxCascadeDepth}</small></div>
            <div><span>{reviewing ? 'Replay turn' : 'Position proof'}</span><strong>{reviewing ? boundedReplayTurn : stateFingerprint(game).slice(0, 5)}</strong><small>{reviewing ? `of ${game.turn}` : 'deterministic fingerprint'}</small></div>
          </div>

          <div className="mc-objectives" aria-label="Current objectives">
            {displayedGame.objectives.map((objective, index) => {
              const copy = objectiveCopy(objective);
              const target = objectiveTarget(objective);
              const color = OBJECTIVE_COLORS[index % OBJECTIVE_COLORS.length];
              return (
                <article
                  className={`mc-objective${objective.completed ? ' done' : ''}`}
                  key={`${objective.spec.type}-${index}`}
                  style={{ '--objective-color': color } as CSSProperties}
                >
                  <span className="mc-objective-icon" aria-hidden="true">{copy.icon}</span>
                  <div><strong>{copy.label}</strong><small>{objective.current} / {target}{objective.completed ? ' · complete' : ''}</small></div>
                  <span className="mc-objective-meter" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, objective.current / target * 100)}%` }} />
                  </span>
                </article>
              );
            })}
          </div>

          <div className="mc-board-stage">
            <div className="mc-board-frame">
              <div
                className="mc-board"
                role="grid"
                aria-label={`${displayedGame.config.rows} by ${displayedGame.config.columns} Mind Cascade board${reviewing ? ` at replay turn ${boundedReplayTurn}` : ''}`}
                aria-rowcount={displayedGame.config.rows}
                aria-colcount={displayedGame.config.columns}
                style={{
                  '--mc-columns': displayedGame.config.columns,
                  '--mc-rows': displayedGame.config.rows,
                } as CSSProperties}
              >
                {displayedGame.board.flatMap((row, rowIndex) =>
                  row.map((cell, columnIndex) => {
                    const index = rowIndex * displayedGame.config.columns + columnIndex;
                    const position = { row: rowIndex, column: columnIndex };
                    const tile = cell.tile;
                    const presentation = tile ? TILE_PRESENTATION[tile.kind] : TILE_PRESENTATION.slate;
                    const isForecasted = Boolean(forecast && (
                      samePosition(forecast.swap.from, position)
                      || samePosition(forecast.swap.to, position)
                    ));
                    const power = tile?.power === 'mirror'
                      ? 'Mirror'
                      : tile?.power === 'orbit'
                        ? 'Orbit'
                        : '';
                    const label = `${positionLabel(position)}, ${tile ? presentation.label : 'empty'}${power ? `, ${power} power` : ''}${cell.marked ? ', marked objective coordinate' : ''}`;
                    return (
                      <button
                        key={`cell-${rowIndex}-${columnIndex}`}
                        ref={(element) => { tileRefs.current[index] = element; }}
                        className={[
                          'mc-tile',
                          samePosition(selected, position) && !reviewing ? 'selected' : '',
                          isForecasted && !reviewing ? 'forecasted' : '',
                          cell.marked ? 'marked' : '',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        role="gridcell"
                        aria-label={label}
                        aria-selected={samePosition(selected, position)}
                        aria-rowindex={rowIndex + 1}
                        aria-colindex={columnIndex + 1}
                        data-kind={tile?.kind ?? 'empty'}
                        data-pattern={presentation.pattern}
                        data-row={rowIndex}
                        data-column={columnIndex}
                        tabIndex={index === focusIndex ? 0 : -1}
                        disabled={!tile || paused || reviewing || game.status !== 'playing'}
                        style={{ '--tile-hue': presentation.hue } as CSSProperties}
                        onFocus={() => setFocusIndex(index)}
                        onClick={() => commitTile(position)}
                        onKeyDown={(event) => onTileKeyDown(event, index, position)}
                      >
                        <span className="mc-glyph" aria-hidden="true">{presentation.glyph}</span>
                        {power ? <span className="mc-power" aria-hidden="true">{tile?.power === 'mirror' ? '↔' : '◎'}</span> : null}
                        <span className="mc-cell-index" aria-hidden="true">{positionLabel(position)}</span>
                      </button>
                    );
                  }))}
              </div>
              {paused ? (
                <div className="mc-pause" role="dialog" aria-labelledby="mc-pause-title">
                  <span aria-hidden="true">Ⅱ</span>
                  <h3 id="mc-pause-title">Board paused</h3>
                  <p>No clock is running. Resume whenever you are ready; the position and move allowance are unchanged.</p>
                  <button ref={resumeButtonRef} className="btn primary" type="button" onClick={togglePause}>Resume board</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mc-board-help">
            <span>Pointer: select two adjacent tiles.</span>
            <span>Keyboard: <kbd>Arrows</kbd> move · <kbd>Enter</kbd> select · <kbd>Esc</kbd> cancel.</span>
          </div>
          <p className={`mc-live-note${messageIsError ? ' error' : ''}`} role="status" aria-live="polite">{liveMessage}</p>

          {game.status !== 'playing' ? (
            <section className="mc-complete" aria-labelledby="mc-complete-title">
              <span className="section-overline">{game.status === 'won' ? 'Objectives complete' : 'Session reflection ready'}</span>
              <h2 id="mc-complete-title">
                {game.status === 'won' ? 'The plan held together.' : 'The move allowance is complete.'}
              </h2>
              <p>
                {game.status === 'won'
                  ? `All ${game.objectives.length} objectives were completed in ${game.turn} moves.`
                  : `${game.objectives.filter((objective) => objective.completed).length} of ${game.objectives.length} objectives were completed. The replay is preserved so the turning point can be studied.`}
              </p>
              {completion?.unlockedAchievementIds.length ? (
                <p>
                  Fixed milestone earned:{' '}
                  {completion.unlockedAchievementIds.map((id) =>
                    MIND_CASCADE_ACHIEVEMENTS.find((item) => item.id === id)?.title ?? id).join(', ')}.
                </p>
              ) : null}
              <div className="mc-complete-actions">
                <button className="btn primary" type="button" onClick={() => startFresh(session.difficulty)}>Try another board</button>
                <button className="btn" type="button" onClick={() => setCoachTab('coach')}>Read session coaching</button>
                <Link className="btn" to="/mind-games">Open skill evidence</Link>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="mc-coach-card" aria-labelledby="mc-coach-title">
          <div className="mc-coach-head">
            <span className="section-overline">Explainable support</span>
            <h2 id="mc-coach-title">Strategy lens</h2>
            <p>Support is optional and recorded as context—not treated as failure. Forecasts simulate the same deterministic rules as the board.</p>
          </div>
          <div className="mc-coach-tabs" role="tablist" aria-label="Strategy lens">
            {([
              ['forecast', 'Forecast'],
              ['coach', 'Coach'],
              ['objectives', 'Objectives'],
            ] as const).map(([tab, label], index) => (
              <button
                key={tab}
                ref={(element) => { coachTabRefs.current[index] = element; }}
                id={`mc-${tab}-tab`}
                type="button"
                role="tab"
                aria-selected={coachTab === tab}
                aria-controls={`mc-${tab}-panel`}
                tabIndex={coachTab === tab ? 0 : -1}
                className={coachTab === tab ? 'on' : ''}
                onClick={() => openCoachTab(tab)}
                onKeyDown={(event) => onCoachTabKeyDown(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="mc-coach-body"
            id={`mc-${coachTab}-panel`}
            role="tabpanel"
            aria-labelledby={`mc-${coachTab}-tab`}
          >
            {coachTab === 'forecast' ? (
              <>
                <div className="mc-coach-action">
                  <span>Top legal swaps, ranked by objective progress, formation value and cascade depth.</span>
                  <b>{analyses.length}</b>
                </div>
                <div className="mc-forecast-list">
                  {analyses.map((analysis, index) => (
                    <button
                      className={`mc-forecast${forecast === analysis ? ' on' : ''}`}
                      type="button"
                      key={`${positionLabel(analysis.swap.from)}-${positionLabel(analysis.swap.to)}`}
                      aria-pressed={forecast === analysis}
                      data-from-row={analysis.swap.from.row}
                      data-from-column={analysis.swap.from.column}
                      data-to-row={analysis.swap.to.row}
                      data-to-column={analysis.swap.to.column}
                      onClick={() => chooseForecast(analysis)}
                    >
                      <span className="mc-rank">#{index + 1}</span>
                      <span>
                        <strong>{positionLabel(analysis.swap.from)} → {positionLabel(analysis.swap.to)}</strong>
                        <small>{analysis.reason}</small>
                      </span>
                      <b>+{analysis.scoreEstimate}</b>
                    </button>
                  ))}
                </div>
                {forecast ? (
                  <div className="mc-forecast-detail">
                    <strong>Why this candidate ranks here</strong>
                    <p>{forecast.reason}. It forecasts {forecast.immediateClears} immediate clears, {forecast.cascadeDepth} cascade step{forecast.cascadeDepth === 1 ? '' : 's'}, {forecast.objectiveGain} objective progress and {forecast.specialsCreated} spatial special{forecast.specialsCreated === 1 ? '' : 's'}.</p>
                  </div>
                ) : null}
                {analyses.length === 0 ? <p className="mc-empty-inline">Forecast closes when a session is complete. Use the replay below to inspect the actual sequence.</p> : null}
              </>
            ) : null}

            {coachTab === 'coach' ? (
              <div className="mc-coach-list">
                {coaching.map((message) => (
                  <article className="mc-coach-message" key={message.id}>
                    <span>{message.tone} · {message.signal.replace('-', ' ')}</span>
                    <h3>{message.title}</h3>
                    <p>{message.message}</p>
                    <small>{message.evidence}</small>
                    <small><b>Try next:</b> {message.nextAction}</small>
                  </article>
                ))}
                {coaching.length === 0 ? <p className="mc-empty-inline">Commit a move to create session-specific coaching evidence.</p> : null}
              </div>
            ) : null}

            {coachTab === 'objectives' ? (
              <div className="mc-objective-guide">
                {game.objectives.map((objective, index) => {
                  const copy = objectiveCopy(objective);
                  return (
                    <article key={`${objective.spec.type}-guide-${index}`}>
                      <strong>{copy.icon} {copy.label}</strong>
                      <p>{copy.guide}</p>
                    </article>
                  );
                })}
                <article>
                  <strong>↔ Mirror and ◎ Orbit</strong>
                  <p>A line of four creates a Mirror that reaches the reflected coordinate. An intersection creates an Orbit that reaches two spaces in each cardinal direction.</p>
                </article>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="mc-replay-card" aria-labelledby="mc-replay-title">
          <div className="mc-replay-head">
            <div>
              <span className="section-overline">Verified reflection</span>
              <h2 id="mc-replay-title">Replay every committed decision.</h2>
            </div>
            <p>Each turn is rebuilt from the original seed and checked against its position fingerprint. A mismatch stops replay instead of inventing a board.</p>
          </div>
          <div className="mc-replay-grid">
            <div className="mc-timeline">
              <div className="mc-timeline-controls">
                <button className="btn" type="button" onClick={() => showReplayTurn(boundedReplayTurn - 1)} disabled={boundedReplayTurn === 0}>←</button>
                <input
                  type="range"
                  min="0"
                  max={game.turn}
                  value={boundedReplayTurn}
                  aria-label="Replay turn"
                  onChange={(event) => showReplayTurn(Number(event.target.value))}
                />
                <button className="btn" type="button" onClick={() => showReplayTurn(boundedReplayTurn + 1)} disabled={boundedReplayTurn === game.turn}>→</button>
              </div>
              <p className="mc-timeline-readout">Turn {boundedReplayTurn} of {game.turn} · fingerprint {stateFingerprint(displayedGame)}</p>
              <div className="mc-move-strip" aria-label="Current session replay turns">
                {snapshots.map((snapshot, index) => {
                  const record = game.history[index - 1];
                  return (
                    <button
                      type="button"
                      className={boundedReplayTurn === index ? 'on' : ''}
                      key={`${snapshot.seed}-${index}`}
                      onClick={() => showReplayTurn(index)}
                    >
                      <strong>{index === 0 ? 'Starting board' : `Turn ${index} · ${positionLabel(record.swap.from)} → ${positionLabel(record.swap.to)}`}</strong>
                      <small>{index === 0 ? 'Seeded position' : `+${record.scoreDelta} · ${record.cascades.length} cascade step${record.cascades.length === 1 ? '' : 's'}`}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <aside className="mc-history">
              <h3>Local replay archive</h3>
              <div className="mc-history-list">
                {progress.replays.slice(0, 4).map((replay) => (
                  <button type="button" key={replay.id} onClick={() => openArchivedReplay(replay)}>
                    <strong>{replay.title}</strong>
                    <span>{replay.steps.length} turns · {replay.score.toLocaleString()} points · seed {replay.seed}</span>
                    <span>Open verified replay →</span>
                  </button>
                ))}
              </div>
              {progress.replays.length === 0 ? (
                <p className="mc-empty-inline">Completed sessions appear here. Replays stay on this device.</p>
              ) : null}
              {completion ? (
                <p className="mc-empty-inline">
                  {completion.recommendation.label} · {completion.recommendation.confidence}% confidence.
                </p>
              ) : null}
            </aside>
          </div>
        </section>
      </section>
    </div>
  );
}

export default function MindCascade() {
  const [searchParams] = useSearchParams();
  const routeMode: RouteMode = searchParams.get('resume') === '1'
    ? 'resume'
    : searchParams.get('daily') === '1'
      ? 'daily'
      : 'classic';
  return <MindCascadeExperience key={routeMode} routeMode={routeMode} />;
}
