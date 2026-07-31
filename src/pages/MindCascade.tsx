import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { playSound } from '../audio/sound';
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
  type CascadeStep,
  type MindGameState,
  type MoveAnalysis,
  type ObjectiveProgress,
  type Position,
  type ReplayBundle,
  type TileKind,
  type TurnRecord,
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

type GardenEffectPhase = 'swap' | 'cascade' | 'settle' | 'finale' | 'invalid';
type SpatialPower = 'mirror' | 'orbit';
type PointerDragAxis = 'horizontal' | 'vertical' | 'none';

interface PointerDragIntent {
  readonly axis: PointerDragAxis;
  readonly crossedThreshold: boolean;
  readonly target: Position | null;
}

interface ActivePointerDrag {
  readonly pointerId: number;
  readonly source: Position;
  readonly sourceElement: HTMLButtonElement;
  readonly startX: number;
  readonly startY: number;
  readonly maximumOffsetX: number;
  readonly maximumOffsetY: number;
  axis: PointerDragAxis;
  crossedThreshold: boolean;
  target: Position | null;
  targetElement: HTMLButtonElement | null;
  paintedTargetElement: HTMLButtonElement | null;
  offsetX: number;
  offsetY: number;
  paintFrame: number | null;
}

const POINTER_DRAG_THRESHOLD = 10;

interface GardenEffect {
  readonly id: number;
  readonly phase: GardenEffectPhase;
  readonly activeDepth: number;
  readonly reducedMotion: boolean;
  readonly turn?: TurnRecord;
  readonly invalidSwap?: readonly [Position, Position];
  readonly newlyCompletedObjectives: ReadonlyArray<number>;
  readonly markedPositions: ReadonlyArray<Position>;
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

function effectPositionKey(position: Position): string {
  return `${position.row}:${position.column}`;
}

function hasPosition(positions: ReadonlyArray<Position>, position: Position): boolean {
  const key = effectPositionKey(position);
  return positions.some((candidate) => effectPositionKey(candidate) === key);
}

interface PowerPositionGroup {
  readonly origins: ReadonlyArray<Position>;
  readonly affected: ReadonlyArray<Position>;
  readonly created: ReadonlyArray<Position>;
}

export interface CascadePowerVisuals {
  readonly powers: ReadonlyArray<SpatialPower>;
  readonly mirror: PowerPositionGroup;
  readonly orbit: PowerPositionGroup;
}

export function getCascadePowerVisuals(
  cascade?: Pick<CascadeStep, 'activatedSpecials' | 'createdSpecials'>,
): CascadePowerVisuals {
  const group = (power: SpatialPower): PowerPositionGroup => ({
    origins: cascade?.activatedSpecials
      .filter((special) => special.power === power)
      .map((special) => special.position) ?? [],
    affected: cascade?.activatedSpecials
      .filter((special) => special.power === power)
      .flatMap((special) => special.affected) ?? [],
    created: cascade?.createdSpecials
      .filter((special) => special.power === power)
      .map((special) => special.position) ?? [],
  });
  const mirror = group('mirror');
  const orbit = group('orbit');
  return {
    powers: ([
      mirror.origins.length || mirror.created.length ? 'mirror' : null,
      orbit.origins.length || orbit.created.length ? 'orbit' : null,
    ].filter(Boolean) as SpatialPower[]),
    mirror,
    orbit,
  };
}

export function getSwapMotion(swap?: {
  readonly from: Position;
  readonly to: Position;
}): {
  readonly axis: 'horizontal' | 'vertical' | 'none';
  readonly direction: 'left' | 'right' | 'up' | 'down' | 'none';
  readonly fromX: string;
  readonly fromY: string;
  readonly toX: string;
  readonly toY: string;
} {
  if (!swap) {
    return {
      axis: 'none',
      direction: 'none',
      fromX: '0%',
      fromY: '0%',
      toX: '0%',
      toY: '0%',
    };
  }
  const columnDelta = Math.sign(swap.to.column - swap.from.column);
  const rowDelta = Math.sign(swap.to.row - swap.from.row);
  return {
    axis: columnDelta === 0 ? 'vertical' : 'horizontal',
    direction: columnDelta < 0
      ? 'left'
      : columnDelta > 0
        ? 'right'
        : rowDelta < 0
          ? 'up'
          : 'down',
    fromX: `${columnDelta * 12}%`,
    fromY: `${rowDelta * 12}%`,
    toX: `${columnDelta * -12}%`,
    toY: `${rowDelta * -12}%`,
  };
}

export function getPointerDragIntent(
  source: Position,
  deltaX: number,
  deltaY: number,
  rows: number,
  columns: number,
  threshold = POINTER_DRAG_THRESHOLD,
  lockedAxis: PointerDragAxis = 'none',
): PointerDragIntent {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (lockedAxis === 'none' && Math.max(horizontalDistance, verticalDistance) < threshold) {
    return {
      axis: 'none',
      crossedThreshold: false,
      target: null,
    };
  }

  const axis: PointerDragAxis = lockedAxis === 'none'
    ? horizontalDistance >= verticalDistance
      ? 'horizontal'
      : 'vertical'
    : lockedAxis;
  const direction = axis === 'horizontal' ? Math.sign(deltaX) : Math.sign(deltaY);
  if (direction === 0) {
    return {
      axis,
      crossedThreshold: true,
      target: null,
    };
  }

  const target = axis === 'horizontal'
    ? { row: source.row, column: source.column + direction }
    : { row: source.row + direction, column: source.column };
  return {
    axis,
    crossedThreshold: true,
    target: target.row >= 0
      && target.row < rows
      && target.column >= 0
      && target.column < columns
      ? target
      : null,
  };
}

function reducedMotionIsActive(): boolean {
  if (typeof document === 'undefined') return false;
  const mode = document.documentElement.dataset.motion;
  if (mode === 'reduced') return true;
  if (mode === 'full') return false;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function effectPositionStyle(
  position: Position,
  rows: number,
  columns: number,
  index = 0,
): CSSProperties {
  return {
    '--fx-row': position.row,
    '--fx-column': position.column,
    '--fx-rows': rows,
    '--fx-columns': columns,
    '--fx-index': index,
  } as CSSProperties;
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
    'Drag or swipe a tile toward an adjacent tile, or select two adjacent tiles.',
  );
  const [messageIsError, setMessageIsError] = useState(false);
  const [gardenEffect, setGardenEffect] = useState<GardenEffect | null>(null);
  const [completion, setCompletion] = useState<CompletionSummary | null>(null);
  const [replayTurn, setReplayTurn] = useState(bootstrap.runtime.game.turn);
  const decisionStartedAt = useRef<number | null>(Date.now());
  const effectSequence = useRef(0);
  const effectTimers = useRef<number[]>([]);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const pointerDrag = useRef<ActivePointerDrag | null>(null);
  const suppressNextClick = useRef(false);
  const suppressClickTimer = useRef<number | null>(null);
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
  const activeCascade = gardenEffect?.phase === 'cascade' && gardenEffect.turn
    ? gardenEffect.turn.cascades[gardenEffect.activeDepth - 1]
    : undefined;
  const powerVisuals = getCascadePowerVisuals(activeCascade);
  const activePowers = powerVisuals.powers;
  const activeSwap = gardenEffect?.turn?.swap ?? (gardenEffect?.invalidSwap
    ? { from: gardenEffect.invalidSwap[0], to: gardenEffect.invalidSwap[1] }
    : undefined);
  const swapMotion = getSwapMotion(activeSwap);
  const activeCleared = activeCascade?.cleared ?? [];
  const activeMatched = activeCascade?.matched ?? [];
  const activeCreated = [...powerVisuals.mirror.created, ...powerVisuals.orbit.created];
  const activeFormationCells = activeCascade?.formations.flatMap((formation) => formation.cells) ?? [];

  const clearPointerDrag = (releaseCapture = true) => {
    const active = pointerDrag.current;
    if (!active) return;
    pointerDrag.current = null;
    if (active.paintFrame !== null) {
      window.cancelAnimationFrame(active.paintFrame);
    }
    active.sourceElement.classList.remove('drag-source');
    active.sourceElement.style.removeProperty('--mc-drag-x');
    active.sourceElement.style.removeProperty('--mc-drag-y');
    active.paintedTargetElement?.classList.remove('drag-target');
    active.targetElement?.classList.remove('drag-target');
    const frame = boardFrameRef.current;
    frame?.classList.remove('is-dragging');
    frame?.removeAttribute('data-drag-axis');
    if (
      releaseCapture
      && typeof active.sourceElement.hasPointerCapture === 'function'
      && active.sourceElement.hasPointerCapture(active.pointerId)
    ) {
      active.sourceElement.releasePointerCapture(active.pointerId);
    }
  };

  const suppressSyntheticClick = () => {
    suppressNextClick.current = true;
    if (suppressClickTimer.current !== null) {
      window.clearTimeout(suppressClickTimer.current);
    }
    suppressClickTimer.current = window.setTimeout(() => {
      suppressNextClick.current = false;
      suppressClickTimer.current = null;
    }, 350);
  };

  const paintPointerDrag = (active: ActivePointerDrag) => {
    if (active.paintFrame !== null) return;
    active.paintFrame = window.requestAnimationFrame(() => {
      active.paintFrame = null;
      if (pointerDrag.current !== active || !active.crossedThreshold) return;
      const frame = boardFrameRef.current;
      const offsetX = Math.max(
        -active.maximumOffsetX,
        Math.min(active.maximumOffsetX, active.offsetX),
      );
      const offsetY = Math.max(
        -active.maximumOffsetY,
        Math.min(active.maximumOffsetY, active.offsetY),
      );

      frame?.classList.add('is-dragging');
      frame?.setAttribute('data-drag-axis', active.axis);
      active.sourceElement.classList.add('drag-source');
      active.sourceElement.style.setProperty('--mc-drag-x', `${offsetX}px`);
      active.sourceElement.style.setProperty('--mc-drag-y', `${offsetY}px`);
      if (active.paintedTargetElement !== active.targetElement) {
        active.paintedTargetElement?.classList.remove('drag-target');
        active.targetElement?.classList.add('drag-target');
        active.paintedTargetElement = active.targetElement;
      }
    });
  };

  const updatePointerDrag = (
    pointerId: number,
    clientX: number,
    clientY: number,
  ): ActivePointerDrag | null => {
    const active = pointerDrag.current;
    if (!active || active.pointerId !== pointerId) return null;
    const deltaX = clientX - active.startX;
    const deltaY = clientY - active.startY;
    const intent = getPointerDragIntent(
      active.source,
      deltaX,
      deltaY,
      displayedGame.config.rows,
      displayedGame.config.columns,
      POINTER_DRAG_THRESHOLD,
      active.crossedThreshold ? active.axis : 'none',
    );
    active.crossedThreshold = intent.crossedThreshold;
    active.axis = intent.axis;
    active.target = intent.target;
    active.targetElement = intent.target
      ? tileRefs.current[intent.target.row * displayedGame.config.columns + intent.target.column] ?? null
      : null;
    active.offsetX = intent.axis === 'horizontal' ? deltaX : 0;
    active.offsetY = intent.axis === 'vertical' ? deltaY : 0;
    if (active.crossedThreshold) paintPointerDrag(active);
    return active;
  };

  const clearEffectTimers = () => {
    effectTimers.current.forEach((timer) => window.clearTimeout(timer));
    effectTimers.current = [];
  };

  const scheduleEffect = (callback: () => void, delay: number) => {
    effectTimers.current.push(window.setTimeout(callback, delay));
  };

  const clearGardenEffect = () => {
    clearEffectTimers();
    setGardenEffect(null);
  };

  useEffect(() => () => {
    effectTimers.current.forEach((timer) => window.clearTimeout(timer));
    effectTimers.current = [];
    clearPointerDrag();
    if (suppressClickTimer.current !== null) {
      window.clearTimeout(suppressClickTimer.current);
      suppressClickTimer.current = null;
    }
  }, []);

  const beginInvalidEffect = (from: Position, to: Position) => {
    clearEffectTimers();
    const id = effectSequence.current + 1;
    effectSequence.current = id;
    const reducedMotion = reducedMotionIsActive();
    setGardenEffect({
      id,
      phase: 'invalid',
      activeDepth: 0,
      reducedMotion,
      invalidSwap: [from, to],
      newlyCompletedObjectives: [],
      markedPositions: [],
    });
    playSound('illegal', {
      intensity: .55,
      pan: (to.column / Math.max(1, game.config.columns - 1)) * 2 - 1,
    });
    scheduleEffect(() => setGardenEffect((current) => current?.id === id ? null : current), reducedMotion ? 320 : 520);
  };

  const beginTurnEffect = (
    turn: TurnRecord,
    before: MindGameState,
    after: MindGameState,
  ) => {
    clearEffectTimers();
    const id = effectSequence.current + 1;
    effectSequence.current = id;
    const reducedMotion = reducedMotionIsActive();
    const newlyCompletedObjectives = after.objectives
      .map((objective, index) => objective.completed && !before.objectives[index]?.completed ? index : -1)
      .filter((index) => index >= 0);
    const markedPositions = turn.cascades
      .flatMap((cascade) => cascade.cleared)
      .filter((position, index, all) =>
        before.board[position.row]?.[position.column]?.marked
        && all.findIndex((candidate) => samePosition(candidate, position)) === index);
    const base: GardenEffect = {
      id,
      phase: reducedMotion ? 'settle' : 'swap',
      activeDepth: reducedMotion ? turn.cascades.length : 0,
      reducedMotion,
      turn,
      newlyCompletedObjectives,
      markedPositions,
    };
    setGardenEffect(base);

    const pan = (turn.swap.to.column / Math.max(1, before.config.columns - 1)) * 2 - 1;
    playSound('place', { intensity: .48, pan });

    if (reducedMotion) {
      playSound('cascade', {
        intensity: Math.min(1, .45 + turn.cascades.length * .12),
        depth: turn.cascades.length,
        pan,
      });
      if (turn.cascades.some((cascade) =>
        cascade.createdSpecials.length > 0 || cascade.activatedSpecials.length > 0)) {
        playSound('special', { intensity: .7, depth: turn.cascades.length, pan });
      }
      if (newlyCompletedObjectives.length > 0) {
        scheduleEffect(() => playSound('objective', { intensity: .76, pan }), 80);
      }
      if (turn.status === 'won') {
        scheduleEffect(() => {
          setGardenEffect((current) => current?.id === id ? { ...current, phase: 'finale' } : current);
          playSound('complete', { intensity: 1, depth: turn.cascades.length, pan });
        }, 170);
      }
      scheduleEffect(() => setGardenEffect((current) => current?.id === id ? null : current), turn.status === 'won' ? 1050 : 760);
      return;
    }

    const cascadeStart = 105;
    const cascadeInterval = 285;
    turn.cascades.forEach((cascade, index) => {
      scheduleEffect(() => {
        setGardenEffect((current) => current?.id === id
          ? { ...current, phase: 'cascade', activeDepth: index + 1 }
          : current);
        playSound('cascade', {
          intensity: Math.min(1, .5 + index * .13),
          depth: cascade.depth,
          pan,
        });
        if (cascade.activatedSpecials.length > 0) {
          playSound('power', { intensity: .82, depth: cascade.depth, pan });
        } else if (cascade.createdSpecials.length > 0 || cascade.formations.length > 0) {
          playSound('special', { intensity: .7, depth: cascade.depth, pan });
        }
      }, cascadeStart + index * cascadeInterval);
    });

    const settleAt = cascadeStart + turn.cascades.length * cascadeInterval;
    scheduleEffect(() => {
      setGardenEffect((current) => current?.id === id
        ? { ...current, phase: 'settle', activeDepth: turn.cascades.length }
        : current);
      playSound(turn.cascades.length > 1 ? 'combo' : 'score', {
        intensity: Math.min(1, .45 + turn.scoreDelta / 600),
        depth: turn.cascades.length,
        pan,
      });
    }, settleAt);
    if (newlyCompletedObjectives.length > 0) {
      scheduleEffect(() => playSound('objective', { intensity: .82, pan }), settleAt + 120);
    }
    if (turn.status === 'won') {
      scheduleEffect(() => {
        setGardenEffect((current) => current?.id === id
          ? { ...current, phase: 'finale' }
          : current);
        playSound('complete', { intensity: 1, depth: turn.cascades.length, pan });
      }, settleAt + 260);
    }
    scheduleEffect(
      () => setGardenEffect((current) => current?.id === id ? null : current),
      settleAt + (turn.status === 'won' ? 1660 : 920),
    );
  };

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
    clearPointerDrag();
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
    clearGardenEffect();
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

  const commitSwap = (from: Position, to: Position) => {
    if (
      paused
      || reviewing
      || game.status !== 'playing'
      || !isAdjacent(from, to)
    ) return;
    const nextGame = applyMove(game, { from, to });
    if (nextGame === game) {
      const nextSession = {
        ...session,
        invalidSwaps: session.invalidSwaps + 1,
      };
      setSession(nextSession);
      if (game.turn > 0) persistResume(nextSession);
      beginInvalidEffect(from, to);
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
    if (turn) beginTurnEffect(turn, game, nextGame);
    setSession(nextSession);
    setSelected(null);
    setForecast(null);
    setReplayTurn(nextGame.turn);
    decisionStartedAt.current = now;
    const depth = turn?.cascades.length ?? 0;
    const cleared = turn?.cascades.reduce((sum, step) => sum + step.cleared.length, 0) ?? 0;
    const formations = turn?.cascades.reduce((sum, step) => sum + step.formations.length, 0) ?? 0;
    const specials = turn?.cascades.reduce(
      (sum, step) => sum + step.createdSpecials.length + step.activatedSpecials.length,
      0,
    ) ?? 0;
    const newlyCompleted = nextGame.objectives.filter(
      (objective, index) => objective.completed && !game.objectives[index]?.completed,
    ).length;
    setLiveMessage(
      [
        `${positionLabel(from)} → ${positionLabel(to)} resolved ${depth} cascade step${depth === 1 ? '' : 's'}`,
        `cleared ${cleared} tiles`,
        `added ${turn?.scoreDelta ?? 0} points`,
        formations ? `created ${formations} formation${formations === 1 ? '' : 's'}` : '',
        specials ? `shaped or activated ${specials} spatial power${specials === 1 ? '' : 's'}` : '',
        newlyCompleted ? `completed ${newlyCompleted} objective${newlyCompleted === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(', ') + '.',
    );
    setMessageIsError(false);
    if (nextGame.status === 'playing') persistResume(nextSession);
    else archiveCompletion(nextSession);
  };

  const commitTile = (position: Position) => {
    if (paused || reviewing || game.status !== 'playing') return;
    if (!selected) {
      setSelected(position);
      playSound('select', {
        intensity: .34,
        pan: (position.column / Math.max(1, game.config.columns - 1)) * 2 - 1,
      });
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
      playSound('select', {
        intensity: .3,
        pan: (position.column / Math.max(1, game.config.columns - 1)) * 2 - 1,
      });
      setLiveMessage(`${positionLabel(position)} selected instead. Swaps must be orthogonally adjacent.`);
      setMessageIsError(false);
      return;
    }
    commitSwap(selected, position);
  };

  const onTilePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
    position: Position,
  ) => {
    if (
      event.button !== 0
      || event.isPrimary === false
      || paused
      || reviewing
      || game.status !== 'playing'
      || event.currentTarget.disabled
    ) return;
    clearPointerDrag();
    const sourceElement = event.currentTarget;
    const sourceBounds = sourceElement.getBoundingClientRect();
    pointerDrag.current = {
      pointerId: event.pointerId,
      source: position,
      sourceElement,
      startX: event.clientX,
      startY: event.clientY,
      maximumOffsetX: Math.max(28, sourceBounds.width * .96),
      maximumOffsetY: Math.max(28, sourceBounds.height * .96),
      axis: 'none',
      crossedThreshold: false,
      target: null,
      targetElement: null,
      paintedTargetElement: null,
      offsetX: 0,
      offsetY: 0,
      paintFrame: null,
    };
    setFocusIndex(index);
    sourceElement.focus({ preventScroll: true });
    try {
      sourceElement.setPointerCapture(event.pointerId);
    } catch {
      // A browser can decline capture if the pointer ended between dispatch and capture.
    }
  };

  const onTilePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = updatePointerDrag(event.pointerId, event.clientX, event.clientY);
    if (active?.crossedThreshold) event.preventDefault();
  };

  const onTilePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = updatePointerDrag(event.pointerId, event.clientX, event.clientY);
    if (!active) return;
    const wasDrag = active.crossedThreshold;
    const { source, target } = active;
    clearPointerDrag();
    if (!wasDrag) return;

    event.preventDefault();
    suppressSyntheticClick();
    setSelected(null);
    if (!target) {
      setLiveMessage('Swipe stayed at the board edge. Drag toward an available adjacent tile.');
      setMessageIsError(false);
      return;
    }
    commitSwap(source, target);
  };

  const onTilePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerDrag.current?.pointerId !== event.pointerId) return;
    clearPointerDrag(false);
  };

  const onTileLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerDrag.current?.pointerId !== event.pointerId) return;
    clearPointerDrag(false);
  };

  const onTileClick = (position: Position) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      if (suppressClickTimer.current !== null) {
        window.clearTimeout(suppressClickTimer.current);
        suppressClickTimer.current = null;
      }
      return;
    }
    commitTile(position);
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
    clearPointerDrag();
    setForecast(analysis);
    setSelected(analysis.swap.from);
    playSound('select', {
      intensity: .28,
      pan: (analysis.swap.from.column / Math.max(1, game.config.columns - 1)) * 2 - 1,
    });
    const index = analysis.swap.from.row * game.config.columns + analysis.swap.from.column;
    setFocusIndex(index);
    tileRefs.current[index]?.focus();
    setLiveMessage(
      `Forecast selected ${positionLabel(analysis.swap.from)} → ${positionLabel(analysis.swap.to)}. ${analysis.reason}.`,
    );
    setMessageIsError(false);
  };

  const showReplayTurn = (turn: number) => {
    clearPointerDrag();
    clearGardenEffect();
    const nextTurn = Math.max(0, Math.min(game.turn, turn));
    setReplayTurn(nextTurn);
    decisionStartedAt.current = nextTurn < game.turn || paused || game.status !== 'playing'
      ? null
      : Date.now();
  };

  const togglePause = () => {
    clearPointerDrag();
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
    clearPointerDrag();
    clearGardenEffect();
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
              <h2 aria-label={`Mind Cascade, ${currentLevel.name}`}>
                <span>Mind Cascade</span>
                <i aria-hidden="true">·</i>
                <em>{currentLevel.name}</em>
              </h2>
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
                  className={[
                    'mc-objective',
                    objective.completed ? 'done' : '',
                    gardenEffect?.newlyCompletedObjectives.includes(index) ? 'newly-complete' : '',
                  ].filter(Boolean).join(' ')}
                  key={`${objective.spec.type}-${index}`}
                  data-objective-state={gardenEffect?.newlyCompletedObjectives.includes(index) ? 'just-completed' : objective.completed ? 'complete' : 'active'}
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
            <div
              ref={boardFrameRef}
              className={[
                'mc-board-frame',
                gardenEffect ? `is-${gardenEffect.phase}` : '',
                activeSwap ? `is-swap-${swapMotion.axis}` : '',
                gardenEffect?.turn && gardenEffect.turn.cascades.length >= 3 ? 'is-deep-cascade' : '',
              ].filter(Boolean).join(' ')}
              data-effect-phase={gardenEffect?.phase ?? 'idle'}
              data-effect-id={gardenEffect?.id ?? 0}
              data-cascade-depth={gardenEffect?.turn?.cascades.length ?? 0}
              data-active-depth={gardenEffect?.activeDepth ?? 0}
              data-power-effect={activePowers.length ? activePowers.join('+') : 'none'}
              data-swap-axis={swapMotion.axis}
              data-swap-direction={swapMotion.direction}
              data-feedback-motion={gardenEffect?.reducedMotion ? 'condensed' : 'full'}
              style={{
                '--swap-from-x': swapMotion.fromX,
                '--swap-from-y': swapMotion.fromY,
                '--swap-to-x': swapMotion.toX,
                '--swap-to-y': swapMotion.toY,
              } as CSSProperties}
            >
              <div className="mc-board-viewport">
              <div
                className={[
                  'mc-board',
                  gardenEffect?.phase === 'settle' ? 'is-refilling' : '',
                  gardenEffect?.phase === 'finale' ? 'is-complete' : '',
                ].filter(Boolean).join(' ')}
                role="grid"
                aria-label={`${displayedGame.config.rows} by ${displayedGame.config.columns} Mind Cascade board${reviewing ? ` at replay turn ${boundedReplayTurn}` : ''}`}
                aria-describedby="mc-board-instructions"
                aria-rowcount={displayedGame.config.rows}
                aria-colcount={displayedGame.config.columns}
                data-input-methods="drag swipe click keyboard"
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
                    const swapFrom = Boolean(
                      gardenEffect?.turn && samePosition(gardenEffect.turn.swap.from, position),
                    );
                    const swapTo = Boolean(
                      gardenEffect?.turn && samePosition(gardenEffect.turn.swap.to, position),
                    );
                    const invalidFrom = Boolean(
                      gardenEffect?.invalidSwap && samePosition(gardenEffect.invalidSwap[0], position),
                    );
                    const invalidTo = Boolean(
                      gardenEffect?.invalidSwap && samePosition(gardenEffect.invalidSwap[1], position),
                    );
                    const isClearing = hasPosition(activeCleared, position);
                    const isMatched = hasPosition(activeMatched, position);
                    const isCreated = hasPosition(activeCreated, position);
                    const isMirrorOrigin = hasPosition(powerVisuals.mirror.origins, position);
                    const isOrbitOrigin = hasPosition(powerVisuals.orbit.origins, position);
                    const isMirrorAffected = hasPosition(powerVisuals.mirror.affected, position);
                    const isOrbitAffected = hasPosition(powerVisuals.orbit.affected, position);
                    const positionPowers = ([
                      isMirrorOrigin ? 'mirror' : null,
                      isOrbitOrigin ? 'orbit' : null,
                    ].filter(Boolean) as SpatialPower[]);
                    const isPowerOrigin = positionPowers.length > 0;
                    const isPowerAffected = isMirrorAffected || isOrbitAffected;
                    const isFormation = hasPosition(activeFormationCells, position);
                    const isMarkedClear = isClearing && hasPosition(gardenEffect?.markedPositions ?? [], position);
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
                          swapFrom ? 'effect-swap-from' : '',
                          swapTo ? 'effect-swap-to' : '',
                          invalidFrom ? 'effect-invalid-from' : '',
                          invalidTo ? 'effect-invalid-to' : '',
                          isMatched ? 'effect-matched' : '',
                          isClearing ? 'effect-clearing' : '',
                          isCreated ? 'effect-special-created' : '',
                          isPowerOrigin ? 'effect-power-origin' : '',
                          isMirrorOrigin ? 'effect-mirror' : '',
                          isOrbitOrigin ? 'effect-orbit' : '',
                          isPowerAffected ? 'effect-power-affected' : '',
                          isMirrorAffected ? 'effect-mirror-affected' : '',
                          isOrbitAffected ? 'effect-orbit-affected' : '',
                          isFormation ? 'effect-formation' : '',
                          isMarkedClear ? 'effect-marked-clear' : '',
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
                        data-effect={isMarkedClear
                          ? 'marked-clear'
                          : isPowerOrigin
                            ? `${positionPowers.join('+')}-origin`
                            : isCreated
                              ? 'special-created'
                              : isClearing
                                ? 'clearing'
                                : swapFrom || swapTo
                                  ? 'swapping'
                                  : invalidFrom || invalidTo
                                    ? 'invalid'
                                    : 'idle'}
                        tabIndex={index === focusIndex ? 0 : -1}
                        disabled={!tile || paused || reviewing || game.status !== 'playing'}
                        style={{
                          '--tile-hue': presentation.hue,
                          '--tile-row': rowIndex,
                          '--tile-column': columnIndex,
                          '--tile-index': index,
                        } as CSSProperties}
                        onFocus={() => setFocusIndex(index)}
                        onPointerDown={(event) => onTilePointerDown(event, index, position)}
                        onPointerMove={onTilePointerMove}
                        onPointerUp={onTilePointerUp}
                        onPointerCancel={onTilePointerCancel}
                        onLostPointerCapture={onTileLostPointerCapture}
                        onClick={() => onTileClick(position)}
                        onKeyDown={(event) => onTileKeyDown(event, index, position)}
                      >
                        <span className="mc-glyph" aria-hidden="true">{presentation.glyph}</span>
                        {power ? <span className="mc-power" aria-hidden="true">{tile?.power === 'mirror' ? '↔' : '◎'}</span> : null}
                        <span className="mc-cell-index" aria-hidden="true">{positionLabel(position)}</span>
                      </button>
                    );
                  }))}
              </div>
              <div className="mc-garden-ambience" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <i key={`ambience-${index}`} style={{ '--fx-index': index } as CSSProperties} />
                ))}
              </div>
              {gardenEffect ? (
                <div className={`mc-turn-banner is-${gardenEffect.phase}`} aria-hidden="true">
                  {gardenEffect.phase === 'invalid' ? (
                    <>
                      <span>Pattern held</span>
                      <strong>Try a different connection</strong>
                      <small>No move was spent</small>
                    </>
                  ) : gardenEffect.phase === 'swap' ? (
                    <>
                      <span>Patterns in motion</span>
                      <strong>
                        {gardenEffect.turn
                          ? `${positionLabel(gardenEffect.turn.swap.from)} ↔ ${positionLabel(gardenEffect.turn.swap.to)}`
                          : 'Swap'}
                      </strong>
                      <small>Reading the new shape</small>
                    </>
                  ) : gardenEffect.phase === 'cascade' ? (
                    <>
                      <span>Cascade {gardenEffect.activeDepth} of {gardenEffect.turn?.cascades.length}</span>
                      <strong>
                        {gardenEffect.activeDepth >= 3
                          ? 'Garden symphony'
                          : gardenEffect.activeDepth === 2
                            ? 'Beautiful chain'
                            : activePowers.length
                              ? `${activePowers.length === 2
                                ? 'Mirror & Orbit'
                                : activePowers[0] === 'mirror' ? 'Mirror' : 'Orbit'} awakened`
                              : 'Pattern connected'}
                      </strong>
                      <small>+{activeCascade?.score ?? 0} · {activeCleared.length} tiles</small>
                    </>
                  ) : gardenEffect.phase === 'finale' ? (
                    <>
                      <span>Garden complete</span>
                      <strong>Every objective is in bloom</strong>
                      <small>{gardenEffect.turn?.turn} thoughtful move{gardenEffect.turn?.turn === 1 ? '' : 's'}</small>
                    </>
                  ) : (
                    <>
                      <span>{(gardenEffect.turn?.cascades.length ?? 0) > 1 ? 'Chain resolved' : 'Pattern resolved'}</span>
                      <strong>+{gardenEffect.turn?.scoreDelta ?? 0}</strong>
                      <small>
                        {gardenEffect.newlyCompletedObjectives.length
                          ? `${gardenEffect.newlyCompletedObjectives.length} objective${gardenEffect.newlyCompletedObjectives.length === 1 ? '' : 's'} complete`
                          : `${gardenEffect.turn?.cascades.length ?? 0}-step cascade`}
                      </small>
                    </>
                  )}
                </div>
              ) : null}
              {activeCleared.map((position, index) => {
                const marked = hasPosition(gardenEffect?.markedPositions ?? [], position);
                const mirrorPowered = hasPosition(powerVisuals.mirror.affected, position);
                const orbitPowered = hasPosition(powerVisuals.orbit.affected, position);
                const powered = mirrorPowered || orbitPowered;
                const formed = hasPosition(activeFormationCells, position);
                return (
                  <div
                    className={[
                      'mc-cell-effect',
                      marked ? 'is-marked' : '',
                      powered ? 'is-powered' : '',
                      mirrorPowered ? 'is-mirror' : '',
                      orbitPowered ? 'is-orbit' : '',
                      formed ? 'is-formation' : '',
                    ].filter(Boolean).join(' ')}
                    key={`effect-${gardenEffect?.id}-${gardenEffect?.activeDepth}-${effectPositionKey(position)}`}
                    style={effectPositionStyle(position, displayedGame.config.rows, displayedGame.config.columns, index)}
                    aria-hidden="true"
                  >
                    <b />
                    {Array.from({ length: 6 }, (_, particleIndex) => (
                      <i
                        key={`petal-${particleIndex}`}
                        style={{ '--particle-index': particleIndex } as CSSProperties}
                      />
                    ))}
                  </div>
                );
              })}
              {gardenEffect?.turn && ['cascade', 'settle', 'finale'].includes(gardenEffect.phase) ? (
                <div
                  className={`mc-score-floater is-${gardenEffect.phase}`}
                  style={effectPositionStyle(
                    gardenEffect.turn.swap.to,
                    displayedGame.config.rows,
                    displayedGame.config.columns,
                  )}
                  aria-hidden="true"
                >
                  +{gardenEffect.phase === 'cascade' ? activeCascade?.score ?? 0 : gardenEffect.turn.scoreDelta}
                  <small>{gardenEffect.phase === 'cascade' ? `chain ${gardenEffect.activeDepth}` : 'pattern points'}</small>
                </div>
              ) : null}
              {activePowers.map((power) => (
                <div
                  className={`mc-power-wave is-${power}${activePowers.length > 1 ? ' is-mixed' : ''}`}
                  data-power={power}
                  key={`power-${gardenEffect?.id}-${gardenEffect?.activeDepth}-${power}`}
                  aria-hidden="true"
                >
                  <i />
                  <i />
                  <b>{power === 'mirror' ? '↔' : '◎'}</b>
                </div>
              ))}
              {gardenEffect?.phase === 'finale' ? (
                <div className="mc-finale-bloom" aria-hidden="true">
                  <b>✦</b>
                  {Array.from({ length: 14 }, (_, index) => (
                    <i key={`finale-${index}`} style={{ '--fx-index': index } as CSSProperties} />
                  ))}
                </div>
              ) : null}
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

          <div className="mc-board-help" id="mc-board-instructions">
            <span>Pointer: drag or swipe toward an adjacent tile · clicking two adjacent tiles also works.</span>
            <span>Keyboard: <kbd>Arrows</kbd> move · <kbd>Enter</kbd> select · <kbd>Esc</kbd> cancel.</span>
          </div>
          <p
            className={`mc-live-note${messageIsError ? ' error' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {liveMessage}
          </p>

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
