/**
 * Mind Cascade's deterministic puzzle engine.
 *
 * The engine has no timers, network calls or Math.random() dependency. A seed,
 * a normalized configuration and a sequence of swaps are enough to reproduce a
 * complete session on another device.
 */

export const ENGINE_VERSION = 1 as const;
export const TILE_KINDS = ['ember', 'tide', 'grove', 'dawn', 'iris', 'slate'] as const;

export type TileKind = typeof TILE_KINDS[number];
export type TilePower = 'plain' | 'mirror' | 'orbit';
export type FormationKind = 'line-four' | 'intersection';
export type GameStatus = 'playing' | 'won' | 'lost';

export interface Position {
  readonly row: number;
  readonly column: number;
}

export interface Swap {
  readonly from: Position;
  readonly to: Position;
}

export interface Tile {
  readonly id: string;
  readonly kind: TileKind;
  readonly power: TilePower;
}

export interface Cell {
  readonly tile: Tile | null;
  readonly marked: boolean;
}

export type Board = ReadonlyArray<ReadonlyArray<Cell>>;

export type ObjectiveSpec =
  | { readonly type: 'collect'; readonly kind: TileKind; readonly target: number }
  | { readonly type: 'cascade'; readonly targetDepth: number }
  | { readonly type: 'formation'; readonly formation: FormationKind; readonly target: number }
  | { readonly type: 'clear-marked'; readonly target: number };

export interface ObjectiveProgress {
  readonly spec: ObjectiveSpec;
  readonly current: number;
  readonly completed: boolean;
}

export interface GameConfig {
  readonly rows: number;
  readonly columns: number;
  readonly moves: number;
  readonly tileKinds: ReadonlyArray<TileKind>;
  readonly objectives: ReadonlyArray<ObjectiveSpec>;
  readonly markedCells: ReadonlyArray<Position>;
}

export interface MindGameLevel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly strategicFocus: string;
  readonly config: GameConfig;
}

export interface FormationEvent {
  readonly kind: FormationKind;
  readonly cells: ReadonlyArray<Position>;
}

export interface CreatedSpecial {
  readonly position: Position;
  readonly kind: TileKind;
  readonly power: Exclude<TilePower, 'plain'>;
}

export interface ActivatedSpecial {
  readonly position: Position;
  readonly power: Exclude<TilePower, 'plain'>;
  readonly affected: ReadonlyArray<Position>;
}

export interface CascadeStep {
  readonly depth: number;
  readonly matched: ReadonlyArray<Position>;
  readonly cleared: ReadonlyArray<Position>;
  readonly createdSpecials: ReadonlyArray<CreatedSpecial>;
  readonly activatedSpecials: ReadonlyArray<ActivatedSpecial>;
  readonly formations: ReadonlyArray<FormationEvent>;
  readonly markedCleared: number;
  readonly collected: Readonly<Partial<Record<TileKind, number>>>;
  readonly score: number;
}

export interface TurnRecord {
  readonly turn: number;
  readonly swap: Swap;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly rngBefore: number;
  readonly rngAfter: number;
  readonly cascades: ReadonlyArray<CascadeStep>;
  readonly scoreDelta: number;
  readonly movesRemaining: number;
  readonly status: GameStatus;
  readonly reshuffled: boolean;
}

export interface MindGameState {
  readonly version: typeof ENGINE_VERSION;
  readonly seed: number;
  readonly rngState: number;
  readonly nextTileId: number;
  readonly config: GameConfig;
  readonly board: Board;
  readonly movesRemaining: number;
  readonly turn: number;
  readonly score: number;
  readonly objectives: ReadonlyArray<ObjectiveProgress>;
  readonly status: GameStatus;
  readonly history: ReadonlyArray<TurnRecord>;
}

export interface MoveAnalysis {
  readonly swap: Swap;
  readonly immediateClears: number;
  readonly cascadeDepth: number;
  readonly formations: number;
  readonly specialsCreated: number;
  readonly markedCleared: number;
  readonly objectiveGain: number;
  readonly scoreEstimate: number;
  /** A deterministic utility score; larger values are strategically stronger. */
  readonly rank: number;
  readonly reason: string;
}

export interface ReplayBundle {
  readonly version: typeof ENGINE_VERSION;
  readonly seed: number;
  readonly config: GameConfig;
  readonly moves: ReadonlyArray<Swap>;
  readonly fingerprints: ReadonlyArray<string>;
}

export interface CreateGameOptions {
  readonly seed?: number | string;
  readonly levelId?: string;
  readonly config?: Partial<GameConfig>;
}

interface MatchRun {
  readonly cells: ReadonlyArray<Position>;
}

interface MatchInfo {
  readonly matched: ReadonlyArray<Position>;
  readonly runs: ReadonlyArray<MatchRun>;
  readonly intersections: ReadonlyArray<Position>;
}

interface ResolutionResult {
  readonly state: MindGameState;
  readonly record: TurnRecord;
}

const DEFAULT_MARKS: ReadonlyArray<Position> = [
  { row: 0, column: 0 },
  { row: 0, column: 6 },
  { row: 2, column: 3 },
  { row: 3, column: 1 },
  { row: 3, column: 5 },
  { row: 6, column: 0 },
  { row: 6, column: 6 },
];

const BASE_CONFIG: GameConfig = {
  rows: 7,
  columns: 7,
  moves: 24,
  tileKinds: TILE_KINDS.slice(0, 5),
  objectives: [
    { type: 'collect', kind: 'ember', target: 16 },
    { type: 'cascade', targetDepth: 2 },
    { type: 'clear-marked', target: 5 },
  ],
  markedCells: DEFAULT_MARKS.slice(0, 5),
};

function levelConfig(
  moves: number,
  objectives: ReadonlyArray<ObjectiveSpec>,
  markedCells: ReadonlyArray<Position>,
  tileKinds: ReadonlyArray<TileKind> = TILE_KINDS.slice(0, 5),
): GameConfig {
  return { rows: 7, columns: 7, moves, tileKinds, objectives, markedCells };
}

export const MIND_GAME_LEVELS: ReadonlyArray<MindGameLevel> = Object.freeze([
  {
    id: 'pattern-garden',
    name: 'Pattern Garden',
    description: 'Read the grid, gather two patterns and uncover marked coordinates.',
    strategicFocus: 'Scanning, prioritisation and move economy',
    config: levelConfig(
      24,
      [
        { type: 'collect', kind: 'ember', target: 14 },
        { type: 'collect', kind: 'grove', target: 14 },
        { type: 'clear-marked', target: 4 },
      ],
      DEFAULT_MARKS.slice(0, 4),
    ),
  },
  {
    id: 'cascade-atlas',
    name: 'Cascade Atlas',
    description: 'Build a planned chain reaction rather than choosing only the largest immediate match.',
    strategicFocus: 'Tempo, forecasting and cascade construction',
    config: levelConfig(
      22,
      [
        { type: 'cascade', targetDepth: 3 },
        { type: 'formation', formation: 'line-four', target: 2 },
        { type: 'collect', kind: 'tide', target: 18 },
      ],
      DEFAULT_MARKS.slice(0, 3),
    ),
  },
  {
    id: 'symmetry-workshop',
    name: 'Symmetry Workshop',
    description: 'Create abstract Mirror and Orbit tiles, then use their spatial effects deliberately.',
    strategicFocus: 'Symmetry, intersections and delayed effects',
    config: levelConfig(
      26,
      [
        { type: 'formation', formation: 'line-four', target: 3 },
        { type: 'formation', formation: 'intersection', target: 1 },
        { type: 'clear-marked', target: 6 },
      ],
      DEFAULT_MARKS.slice(0, 6),
      TILE_KINDS,
    ),
  },
  {
    id: 'architects-trial',
    name: "Architect's Trial",
    description: 'Balance collection, deep cascades, formations and board control within a tight move limit.',
    strategicFocus: 'Multi-objective planning and adaptive search',
    config: levelConfig(
      28,
      [
        { type: 'collect', kind: 'iris', target: 22 },
        { type: 'cascade', targetDepth: 4 },
        { type: 'formation', formation: 'intersection', target: 2 },
        { type: 'clear-marked', target: 7 },
      ],
      DEFAULT_MARKS,
      TILE_KINDS,
    ),
  },
]);

const positionKey = (position: Position): string => `${position.row}:${position.column}`;
const positionFromKey = (key: string): Position => {
  const [row, column] = key.split(':').map(Number);
  return { row, column };
};
const comparePositions = (a: Position, b: Position): number => a.row - b.row || a.column - b.column;
const samePosition = (a: Position, b: Position): boolean => a.row === b.row && a.column === b.column;
const clampInteger = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};
const uint = (value: number): number => value >>> 0;

/** Stable FNV-1a text hashing for named and daily seeds. */
export function seedFromString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return uint(hash) || 0x9e3779b9;
}

export function dailySeed(dateKey = new Date().toISOString().slice(0, 10)): number {
  return seedFromString(`mind-cascade:${dateKey}`);
}

function normalizeSeed(value: number | string | undefined): number {
  if (typeof value === 'string') return seedFromString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return uint(Math.floor(value)) || 0x9e3779b9;
  return seedFromString('mind-cascade:welcome');
}

/** Mulberry32 expressed as an explicit state transition. */
function nextRandom(rngState: number): readonly [number, number] {
  const nextState = uint(rngState + 0x6d2b79f5);
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return [uint(value ^ (value >>> 14)) / 4294967296, nextState];
}

function randomIndex(rngState: number, length: number): readonly [number, number] {
  const [value, nextState] = nextRandom(rngState);
  return [Math.floor(value * length), nextState];
}

function inBounds(board: Board, position: Position): boolean {
  return position.row >= 0
    && position.column >= 0
    && position.row < board.length
    && position.column < (board[0]?.length ?? 0);
}

function freezePosition(position: Position): Position {
  return Object.freeze({ row: position.row, column: position.column });
}

function freezeSwap(swap: Swap): Swap {
  return Object.freeze({ from: freezePosition(swap.from), to: freezePosition(swap.to) });
}

function freezeBoard(board: Board): Board {
  return Object.freeze(board.map((row) => Object.freeze(row.map((cell) => Object.freeze({
    marked: cell.marked,
    tile: cell.tile ? Object.freeze({ ...cell.tile }) : null,
  })))));
}

function freezeObjectiveSpec(spec: ObjectiveSpec): ObjectiveSpec {
  return Object.freeze({ ...spec });
}

function freezeConfig(config: GameConfig): GameConfig {
  return Object.freeze({
    ...config,
    tileKinds: Object.freeze([...config.tileKinds]),
    objectives: Object.freeze(config.objectives.map(freezeObjectiveSpec)),
    markedCells: Object.freeze(config.markedCells.map(freezePosition)),
  });
}

function freezeFormation(event: FormationEvent): FormationEvent {
  return Object.freeze({
    kind: event.kind,
    cells: Object.freeze(event.cells.map(freezePosition)),
  });
}

function freezeCascade(step: CascadeStep): CascadeStep {
  return Object.freeze({
    ...step,
    matched: Object.freeze(step.matched.map(freezePosition)),
    cleared: Object.freeze(step.cleared.map(freezePosition)),
    createdSpecials: Object.freeze(step.createdSpecials.map((special) => Object.freeze({
      ...special,
      position: freezePosition(special.position),
    }))),
    activatedSpecials: Object.freeze(step.activatedSpecials.map((special) => Object.freeze({
      ...special,
      position: freezePosition(special.position),
      affected: Object.freeze(special.affected.map(freezePosition)),
    }))),
    formations: Object.freeze(step.formations.map(freezeFormation)),
    collected: Object.freeze({ ...step.collected }),
  });
}

function freezeRecord(record: TurnRecord): TurnRecord {
  return Object.freeze({
    ...record,
    swap: freezeSwap(record.swap),
    cascades: Object.freeze(record.cascades.map(freezeCascade)),
  });
}

function freezeState(state: MindGameState): MindGameState {
  return Object.freeze({
    ...state,
    config: Object.isFrozen(state.config) ? state.config : freezeConfig(state.config),
    board: freezeBoard(state.board),
    objectives: Object.freeze(state.objectives.map((objective) => Object.freeze({
      ...objective,
      spec: freezeObjectiveSpec(objective.spec),
    }))),
    history: Object.freeze(state.history.map((record) => (
      Object.isFrozen(record) ? record : freezeRecord(record)
    ))),
  });
}

function normalizeKinds(value: ReadonlyArray<TileKind> | undefined): ReadonlyArray<TileKind> {
  const valid = Array.from(new Set((value ?? []).filter((kind): kind is TileKind => TILE_KINDS.includes(kind))));
  return (valid.length >= 4 ? valid : TILE_KINDS.slice(0, 5)).slice(0, TILE_KINDS.length);
}

function normalizeObjective(spec: ObjectiveSpec, kinds: ReadonlyArray<TileKind>, cellCount: number): ObjectiveSpec {
  if (spec.type === 'collect') {
    return {
      type: 'collect',
      kind: kinds.includes(spec.kind) ? spec.kind : kinds[0],
      target: clampInteger(spec.target, 1, 999, 12),
    };
  }
  if (spec.type === 'cascade') {
    return { type: 'cascade', targetDepth: clampInteger(spec.targetDepth, 2, 12, 2) };
  }
  if (spec.type === 'formation') {
    return {
      type: 'formation',
      formation: spec.formation === 'intersection' ? 'intersection' : 'line-four',
      target: clampInteger(spec.target, 1, 99, 1),
    };
  }
  return { type: 'clear-marked', target: clampInteger(spec.target, 1, cellCount, 4) };
}

function normalizeMarkedCells(
  cells: ReadonlyArray<Position> | undefined,
  rows: number,
  columns: number,
  minimumCount: number,
): ReadonlyArray<Position> {
  const seen = new Set<string>();
  const result: Position[] = [];
  for (const position of cells ?? []) {
    const normalized = {
      row: clampInteger(position?.row, 0, rows - 1, 0),
      column: clampInteger(position?.column, 0, columns - 1, 0),
    };
    const key = positionKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  // A co-prime walk spreads generated marks across the grid instead of
  // clustering them in the first row.
  const cellCount = rows * columns;
  for (let step = 0; result.length < minimumCount && step < cellCount * 2; step += 1) {
    const index = (step * 11 + 3) % cellCount;
    const position = { row: Math.floor(index / columns), column: index % columns };
    const key = positionKey(position);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(position);
  }
  return result;
}

function normalizeConfig(config: Partial<GameConfig> | undefined): GameConfig {
  const rows = clampInteger(config?.rows, 5, 9, BASE_CONFIG.rows);
  const columns = clampInteger(config?.columns, 5, 9, BASE_CONFIG.columns);
  const moves = clampInteger(config?.moves, 1, 99, BASE_CONFIG.moves);
  const tileKinds = normalizeKinds(config?.tileKinds);
  const requested = config?.objectives?.length ? config.objectives : BASE_CONFIG.objectives;
  const objectives = requested.slice(0, 6).map((objective) => normalizeObjective(objective, tileKinds, rows * columns));
  const requiredMarks = objectives.reduce((maximum, objective) => (
    objective.type === 'clear-marked' ? Math.max(maximum, objective.target) : maximum
  ), 0);
  const markedCells = normalizeMarkedCells(config?.markedCells, rows, columns, requiredMarks);
  return freezeConfig({ rows, columns, moves, tileKinds, objectives, markedCells });
}

export function getLevel(levelId: string): MindGameLevel | undefined {
  return MIND_GAME_LEVELS.find((level) => level.id === levelId);
}

function emptyMarkedBoard(config: GameConfig): Cell[][] {
  const marked = new Set(config.markedCells.map(positionKey));
  return Array.from({ length: config.rows }, (_, row) => (
    Array.from({ length: config.columns }, (_, column): Cell => ({
      tile: null,
      marked: marked.has(positionKey({ row, column })),
    }))
  ));
}

function createsImmediateTriple(board: Board, position: Position, kind: TileKind): boolean {
  const leftOne = board[position.row]?.[position.column - 1]?.tile?.kind;
  const leftTwo = board[position.row]?.[position.column - 2]?.tile?.kind;
  const upOne = board[position.row - 1]?.[position.column]?.tile?.kind;
  const upTwo = board[position.row - 2]?.[position.column]?.tile?.kind;
  return (leftOne === kind && leftTwo === kind) || (upOne === kind && upTwo === kind);
}

function fillInitialBoard(
  config: GameConfig,
  rngStart: number,
  firstTileId: number,
): { board: Board; rngState: number; nextTileId: number } {
  let rngState = rngStart;
  let nextTileId = firstTileId;
  let board = emptyMarkedBoard(config);
  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      const position = { row, column };
      const allowed = config.tileKinds.filter((kind) => !createsImmediateTriple(board, position, kind));
      const [choice, nextRng] = randomIndex(rngState, allowed.length);
      rngState = nextRng;
      board[row][column] = {
        ...board[row][column],
        tile: { id: `tile-${nextTileId}`, kind: allowed[choice], power: 'plain' },
      };
      nextTileId += 1;
    }
  }
  return { board: freezeBoard(board), rngState, nextTileId };
}

function boardWithSwappedTiles(board: Board, swap: Swap): Board {
  const result: Cell[][] = board.map((row) => row.map((cell) => ({ ...cell })));
  const first = result[swap.from.row][swap.from.column];
  const second = result[swap.to.row][swap.to.column];
  result[swap.from.row][swap.from.column] = { ...first, tile: second.tile };
  result[swap.to.row][swap.to.column] = { ...second, tile: first.tile };
  return result;
}

function findMatchInfo(board: Board): MatchInfo {
  const runs: MatchRun[] = [];
  const horizontalMembership = new Set<string>();
  const verticalMembership = new Set<string>();
  const rows = board.length;
  const columns = board[0]?.length ?? 0;

  for (let row = 0; row < rows; row += 1) {
    let start = 0;
    while (start < columns) {
      const kind = board[row][start].tile?.kind;
      let end = start + 1;
      while (kind && end < columns && board[row][end].tile?.kind === kind) end += 1;
      if (kind && end - start >= 3) {
        const cells = Array.from({ length: end - start }, (_, offset) => ({ row, column: start + offset }));
        cells.forEach((position) => horizontalMembership.add(positionKey(position)));
        runs.push({ cells });
      }
      start = end;
    }
  }

  for (let column = 0; column < columns; column += 1) {
    let start = 0;
    while (start < rows) {
      const kind = board[start][column].tile?.kind;
      let end = start + 1;
      while (kind && end < rows && board[end][column].tile?.kind === kind) end += 1;
      if (kind && end - start >= 3) {
        const cells = Array.from({ length: end - start }, (_, offset) => ({ row: start + offset, column }));
        cells.forEach((position) => verticalMembership.add(positionKey(position)));
        runs.push({ cells });
      }
      start = end;
    }
  }

  const matchedKeys = new Set<string>();
  runs.forEach((run) => run.cells.forEach((position) => matchedKeys.add(positionKey(position))));
  const intersections = [...horizontalMembership]
    .filter((key) => verticalMembership.has(key))
    .map(positionFromKey)
    .sort(comparePositions);
  return {
    runs,
    intersections,
    matched: [...matchedKeys].map(positionFromKey).sort(comparePositions),
  };
}

/** Returns every cell participating in a horizontal or vertical run of 3+. */
export function getMatchedPositions(board: Board): ReadonlyArray<Position> {
  return Object.freeze(findMatchInfo(board).matched.map(freezePosition));
}

export function isAdjacent(first: Position, second: Position): boolean {
  return Math.abs(first.row - second.row) + Math.abs(first.column - second.column) === 1;
}

function validMovesForBoard(board: Board): Swap[] {
  const moves: Swap[] = [];
  const rows = board.length;
  const columns = board[0]?.length ?? 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const from = { row, column };
      for (const to of [{ row, column: column + 1 }, { row: row + 1, column }]) {
        if (!inBounds(board, to)) continue;
        const swapped = boardWithSwappedTiles(board, { from, to });
        const match = findMatchInfo(swapped);
        if (match.matched.some((position) => samePosition(position, from) || samePosition(position, to))) {
          moves.push({ from, to });
        }
      }
    }
  }
  return moves;
}

export function getValidMoves(state: MindGameState): ReadonlyArray<Swap> {
  if (state.status !== 'playing') return Object.freeze([]);
  return Object.freeze(validMovesForBoard(state.board).map(freezeSwap));
}

export function isValidMove(state: MindGameState, swap: Swap): boolean {
  if (state.status !== 'playing' || !inBounds(state.board, swap.from) || !inBounds(state.board, swap.to)) return false;
  if (!isAdjacent(swap.from, swap.to)) return false;
  return validMovesForBoard(state.board).some((candidate) => (
    (samePosition(candidate.from, swap.from) && samePosition(candidate.to, swap.to))
    || (samePosition(candidate.from, swap.to) && samePosition(candidate.to, swap.from))
  ));
}

function guaranteedPlayableBoard(board: Board, kinds: ReadonlyArray<TileKind>): Board {
  const rows = board.length;
  const columns = board[0]?.length ?? 0;
  const result: Cell[][] = board.map((row) => row.map((cell) => ({ ...cell })));
  const fixed = new Map<string, TileKind>([
    [positionKey({ row: 0, column: 0 }), kinds[0]],
    [positionKey({ row: 0, column: 1 }), kinds[1]],
    [positionKey({ row: 0, column: 2 }), kinds[0]],
    [positionKey({ row: 1, column: 1 }), kinds[0]],
  ]);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const position = { row, column };
      const fixedKind = fixed.get(positionKey(position));
      let kind = fixedKind;
      if (!kind) {
        const offset = (row * 3 + column * 2) % kinds.length;
        for (let attempt = 0; attempt < kinds.length; attempt += 1) {
          const candidate = kinds[(offset + attempt) % kinds.length];
          if (!createsImmediateTriple(result, position, candidate)) {
            kind = candidate;
            break;
          }
        }
      }
      const tile = result[row][column].tile;
      if (!tile || !kind) throw new Error('A playable board requires a tile in every cell.');
      result[row][column] = { ...result[row][column], tile: { ...tile, kind } };
    }
  }
  return freezeBoard(result);
}

function ensurePlayable(
  board: Board,
  kinds: ReadonlyArray<TileKind>,
  rngStart: number,
): { board: Board; rngState: number; reshuffled: boolean } {
  if (findMatchInfo(board).matched.length === 0 && validMovesForBoard(board).length > 0) {
    return { board, rngState: rngStart, reshuffled: false };
  }

  const tiles = board.flat().map((cell) => cell.tile);
  let rngState = rngStart;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const shuffled = [...tiles];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const [other, nextRng] = randomIndex(rngState, index + 1);
      rngState = nextRng;
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    let tileIndex = 0;
    const candidate = board.map((row) => row.map((cell): Cell => ({
      ...cell,
      tile: shuffled[tileIndex++],
    })));
    if (findMatchInfo(candidate).matched.length === 0 && validMovesForBoard(candidate).length > 0) {
      return { board: freezeBoard(candidate), rngState, reshuffled: true };
    }
  }

  const fallback = guaranteedPlayableBoard(board, kinds);
  return { board: fallback, rngState, reshuffled: true };
}

function createObjectiveProgress(specs: ReadonlyArray<ObjectiveSpec>): ReadonlyArray<ObjectiveProgress> {
  return specs.map((spec) => ({ spec, current: 0, completed: false }));
}

export function createGame(options: CreateGameOptions = {}): MindGameState {
  const level = options.levelId ? getLevel(options.levelId) : undefined;
  const config = normalizeConfig({ ...(level?.config ?? BASE_CONFIG), ...(options.config ?? {}) });
  const seed = normalizeSeed(options.seed);
  const generated = fillInitialBoard(config, seed, 0);
  const playable = ensurePlayable(generated.board, config.tileKinds, generated.rngState);
  return freezeState({
    version: ENGINE_VERSION,
    seed,
    rngState: playable.rngState,
    nextTileId: generated.nextTileId,
    config,
    board: playable.board,
    movesRemaining: config.moves,
    turn: 0,
    score: 0,
    objectives: createObjectiveProgress(config.objectives),
    status: 'playing',
    history: [],
  });
}

export function createDailyGame(
  levelId = MIND_GAME_LEVELS[0].id,
  dateKey = new Date().toISOString().slice(0, 10),
): MindGameState {
  return createGame({ seed: dailySeed(dateKey), levelId });
}

function chooseSpawn(
  board: Board,
  candidates: ReadonlyArray<Position>,
  swap: Swap,
  occupied: ReadonlySet<string>,
): Position | null {
  const ordered: Position[] = [];
  for (const preferred of [swap.to, swap.from]) {
    if (candidates.some((candidate) => samePosition(candidate, preferred))) ordered.push(preferred);
  }
  const midpoint = candidates[Math.floor((candidates.length - 1) / 2)];
  if (midpoint) ordered.push(midpoint);
  ordered.push(...[...candidates].sort(comparePositions));
  const seen = new Set<string>();
  for (const position of ordered) {
    const key = positionKey(position);
    if (seen.has(key) || occupied.has(key)) continue;
    seen.add(key);
    if (board[position.row][position.column].tile?.power === 'plain') return position;
  }
  return null;
}

function formationsFromMatch(match: MatchInfo): FormationEvent[] {
  const formations: FormationEvent[] = [];
  for (const run of match.runs) {
    if (run.cells.length >= 4) formations.push({ kind: 'line-four', cells: run.cells });
  }
  for (const intersection of match.intersections) {
    const cells = match.runs
      .filter((run) => run.cells.some((position) => samePosition(position, intersection)))
      .flatMap((run) => run.cells);
    const unique = [...new Map(cells.map((position) => [positionKey(position), position])).values()]
      .sort(comparePositions);
    formations.push({ kind: 'intersection', cells: unique });
  }
  return formations;
}

function specialsFromMatch(
  board: Board,
  match: MatchInfo,
  swap: Swap,
): ReadonlyMap<string, CreatedSpecial> {
  const specials = new Map<string, CreatedSpecial>();
  for (const intersection of match.intersections) {
    const position = chooseSpawn(board, [intersection], swap, new Set(specials.keys()));
    const tile = position ? board[position.row][position.column].tile : null;
    if (position && tile) {
      specials.set(positionKey(position), { position, kind: tile.kind, power: 'orbit' });
    }
  }
  for (const run of match.runs) {
    if (run.cells.length < 4) continue;
    const position = chooseSpawn(board, run.cells, swap, new Set(specials.keys()));
    const tile = position ? board[position.row][position.column].tile : null;
    if (position && tile) {
      specials.set(positionKey(position), { position, kind: tile.kind, power: 'mirror' });
    }
  }
  return specials;
}

function specialEffect(board: Board, position: Position, power: Exclude<TilePower, 'plain'>): Position[] {
  if (power === 'mirror') {
    return [{
      row: board.length - 1 - position.row,
      column: (board[0]?.length ?? 0) - 1 - position.column,
    }].filter((candidate) => inBounds(board, candidate));
  }
  return [
    { row: position.row - 2, column: position.column },
    { row: position.row + 2, column: position.column },
    { row: position.row, column: position.column - 2 },
    { row: position.row, column: position.column + 2 },
  ].filter((candidate) => inBounds(board, candidate));
}

function expandSpecialEffects(
  board: Board,
  initialClear: ReadonlySet<string>,
  protectedSpawns: ReadonlySet<string>,
): { clear: Set<string>; activated: ActivatedSpecial[] } {
  const clear = new Set(initialClear);
  const queue = [...clear].map(positionFromKey).sort(comparePositions);
  const activatedKeys = new Set<string>();
  const activated: ActivatedSpecial[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const position = queue[cursor];
    const key = positionKey(position);
    const tile = board[position.row]?.[position.column]?.tile;
    if (!tile || tile.power === 'plain' || activatedKeys.has(key)) continue;
    activatedKeys.add(key);
    const affected = specialEffect(board, position, tile.power)
      .filter((candidate) => !protectedSpawns.has(positionKey(candidate)))
      .sort(comparePositions);
    activated.push({ position, power: tile.power, affected });
    for (const candidate of affected) {
      const candidateKey = positionKey(candidate);
      if (clear.has(candidateKey)) continue;
      clear.add(candidateKey);
      queue.push(candidate);
    }
  }
  return { clear, activated };
}

function clearAndSpawn(
  board: Board,
  clearKeys: ReadonlySet<string>,
  specials: ReadonlyMap<string, CreatedSpecial>,
): {
  board: Board;
  markedCleared: number;
  collected: Partial<Record<TileKind, number>>;
} {
  let markedCleared = 0;
  const collected: Partial<Record<TileKind, number>> = {};
  const result: Cell[][] = board.map((row, rowIndex) => row.map((cell, columnIndex): Cell => {
    const key = positionKey({ row: rowIndex, column: columnIndex });
    if (!clearKeys.has(key)) return { ...cell };
    if (cell.tile) collected[cell.tile.kind] = (collected[cell.tile.kind] ?? 0) + 1;
    if (cell.marked) markedCleared += 1;
    return { tile: null, marked: false };
  }));

  for (const [key, special] of specials) {
    const position = positionFromKey(key);
    result[position.row][position.column] = {
      ...result[position.row][position.column],
      tile: {
        id: board[position.row][position.column].tile?.id ?? `special-${key}`,
        kind: special.kind,
        power: special.power,
      },
    };
  }
  return { board: result, markedCleared, collected };
}

function collapseAndRefill(
  board: Board,
  kinds: ReadonlyArray<TileKind>,
  rngStart: number,
  firstTileId: number,
): { board: Board; rngState: number; nextTileId: number } {
  const rows = board.length;
  const columns = board[0]?.length ?? 0;
  const result: Cell[][] = board.map((row) => row.map((cell) => ({ ...cell, tile: null })));
  let rngState = rngStart;
  let nextTileId = firstTileId;
  for (let column = 0; column < columns; column += 1) {
    const tiles = board.map((row) => row[column].tile).filter((tile): tile is Tile => Boolean(tile));
    let tileIndex = tiles.length - 1;
    for (let row = rows - 1; row >= 0; row -= 1) {
      if (tileIndex >= 0) {
        result[row][column] = { ...result[row][column], tile: tiles[tileIndex] };
        tileIndex -= 1;
      } else {
        const [choice, nextRng] = randomIndex(rngState, kinds.length);
        rngState = nextRng;
        result[row][column] = {
          ...result[row][column],
          tile: { id: `tile-${nextTileId}`, kind: kinds[choice], power: 'plain' },
        };
        nextTileId += 1;
      }
    }
  }
  return { board: result, rngState, nextTileId };
}

function applyObjectiveEvents(
  objectives: ReadonlyArray<ObjectiveProgress>,
  step: CascadeStep,
): ReadonlyArray<ObjectiveProgress> {
  return objectives.map((objective) => {
    let current = objective.current;
    if (objective.spec.type === 'collect') {
      current += step.collected[objective.spec.kind] ?? 0;
    } else if (objective.spec.type === 'cascade') {
      current = Math.max(current, step.depth);
    } else if (objective.spec.type === 'formation') {
      const requiredFormation = objective.spec.formation;
      current += step.formations.filter((formation) => formation.kind === requiredFormation).length;
    } else {
      current += step.markedCleared;
    }
    const target = objective.spec.type === 'cascade' ? objective.spec.targetDepth : objective.spec.target;
    return { ...objective, current: Math.min(current, target), completed: current >= target };
  });
}

function allObjectivesComplete(objectives: ReadonlyArray<ObjectiveProgress>): boolean {
  return objectives.length > 0 && objectives.every((objective) => objective.completed);
}

function canonicalPosition(position: Position): string {
  return `${position.row},${position.column}`;
}

/** A compact hash of gameplay state. History is deliberately excluded. */
export function stateFingerprint(state: MindGameState): string {
  const board = state.board.map((row) => row.map((cell) => (
    `${cell.tile?.id ?? '-'}:${cell.tile?.kind ?? '-'}:${cell.tile?.power ?? '-'}:${cell.marked ? 1 : 0}`
  )).join('|')).join('/');
  const objectives = state.objectives.map((objective) => `${objective.spec.type}:${objective.current}:${objective.completed ? 1 : 0}`).join('|');
  const source = [
    state.version,
    state.seed,
    state.rngState,
    state.nextTileId,
    state.movesRemaining,
    state.turn,
    state.score,
    state.status,
    objectives,
    board,
  ].join('~');
  return seedFromString(source).toString(16).padStart(8, '0');
}

function resolveSwap(state: MindGameState, swap: Swap): ResolutionResult | null {
  if (!isValidMove(state, swap)) return null;
  const beforeHash = stateFingerprint(state);
  const rngBefore = state.rngState;
  let board = boardWithSwappedTiles(state.board, swap);
  let rngState = state.rngState;
  let nextTileId = state.nextTileId;
  let scoreDelta = 0;
  let objectives = state.objectives;
  const cascades: CascadeStep[] = [];

  for (let depth = 1; depth <= 100; depth += 1) {
    const match = findMatchInfo(board);
    if (match.matched.length === 0) break;
    const formations = formationsFromMatch(match);
    const specials = specialsFromMatch(board, match, swap);
    const initialClear = new Set(match.matched.map(positionKey));
    for (const key of specials.keys()) initialClear.delete(key);
    const effects = expandSpecialEffects(board, initialClear, new Set(specials.keys()));
    const cleared = [...effects.clear].map(positionFromKey).sort(comparePositions);
    const clearedResult = clearAndSpawn(board, effects.clear, specials);
    const stepScore = cleared.length * 10 * depth
      + formations.length * 25
      + effects.activated.length * 20;
    const step: CascadeStep = {
      depth,
      matched: match.matched,
      cleared,
      createdSpecials: [...specials.values()].sort((a, b) => comparePositions(a.position, b.position)),
      activatedSpecials: effects.activated,
      formations,
      markedCleared: clearedResult.markedCleared,
      collected: clearedResult.collected,
      score: stepScore,
    };
    cascades.push(step);
    scoreDelta += stepScore;
    objectives = applyObjectiveEvents(objectives, step);
    const refilled = collapseAndRefill(
      clearedResult.board,
      state.config.tileKinds,
      rngState,
      nextTileId,
    );
    board = refilled.board;
    rngState = refilled.rngState;
    nextTileId = refilled.nextTileId;
  }

  const movesRemaining = state.movesRemaining - 1;
  let status: GameStatus = allObjectivesComplete(objectives)
    ? 'won'
    : movesRemaining <= 0 ? 'lost' : 'playing';
  let reshuffled = false;
  if (status === 'playing') {
    const playable = ensurePlayable(board, state.config.tileKinds, rngState);
    board = playable.board;
    rngState = playable.rngState;
    reshuffled = playable.reshuffled;
  }

  const stateWithoutRecord: MindGameState = {
    ...state,
    rngState,
    nextTileId,
    board,
    movesRemaining,
    turn: state.turn + 1,
    score: state.score + scoreDelta,
    objectives,
    status,
    history: state.history,
  };
  const afterHash = stateFingerprint(stateWithoutRecord);
  const record: TurnRecord = {
    turn: stateWithoutRecord.turn,
    swap,
    beforeHash,
    afterHash,
    rngBefore,
    rngAfter: rngState,
    cascades,
    scoreDelta,
    movesRemaining,
    status,
    reshuffled,
  };
  const finalState = freezeState({
    ...stateWithoutRecord,
    history: [...state.history, freezeRecord(record)],
  });
  return { state: finalState, record: finalState.history[finalState.history.length - 1] };
}

/**
 * Applies one legal orthogonal swap. Invalid, diagonal and post-game moves
 * return the original state reference so a UI can ignore them safely.
 */
export function applyMove(state: MindGameState, swap: Swap): MindGameState {
  return resolveSwap(state, swap)?.state ?? state;
}

function objectiveGain(before: MindGameState, after: MindGameState): number {
  return after.objectives.reduce((total, objective, index) => {
    const previous = before.objectives[index];
    const progress = Math.max(0, objective.current - (previous?.current ?? 0));
    const completion = objective.completed && !previous?.completed ? 3 : 0;
    return total + progress + completion;
  }, 0);
}

export function forecastMove(state: MindGameState, swap: Swap): MoveAnalysis | null {
  const resolved = resolveSwap(state, swap);
  if (!resolved) return null;
  const record = resolved.record;
  const formations = record.cascades.reduce((sum, cascade) => sum + cascade.formations.length, 0);
  const specialsCreated = record.cascades.reduce((sum, cascade) => sum + cascade.createdSpecials.length, 0);
  const markedCleared = record.cascades.reduce((sum, cascade) => sum + cascade.markedCleared, 0);
  const gain = objectiveGain(state, resolved.state);
  const immediateClears = record.cascades[0]?.cleared.length ?? 0;
  const cascadeDepth = record.cascades.length;
  const rank = record.scoreDelta
    + cascadeDepth * 35
    + formations * 55
    + specialsCreated * 70
    + markedCleared * 65
    + gain * 90
    + (resolved.state.status === 'won' ? 10_000 : 0);
  const reasons: string[] = [];
  if (resolved.state.status === 'won') reasons.push('completes every objective');
  if (gain > 0) reasons.push(`adds ${gain} objective progress`);
  if (cascadeDepth > 1) reasons.push(`builds a ${cascadeDepth}-step cascade`);
  if (specialsCreated > 0) reasons.push(`creates ${specialsCreated} spatial special${specialsCreated === 1 ? '' : 's'}`);
  if (markedCleared > 0) reasons.push(`unlocks ${markedCleared} marked cell${markedCleared === 1 ? '' : 's'}`);
  if (reasons.length === 0) reasons.push(`clears ${immediateClears} tiles`);
  return Object.freeze({
    swap: freezeSwap(swap),
    immediateClears,
    cascadeDepth,
    formations,
    specialsCreated,
    markedCleared,
    objectiveGain: gain,
    scoreEstimate: record.scoreDelta,
    rank,
    reason: reasons.join(', '),
  });
}

export function analyzeMoves(state: MindGameState, limit = Number.POSITIVE_INFINITY): ReadonlyArray<MoveAnalysis> {
  const analyses = getValidMoves(state)
    .map((swap) => forecastMove(state, swap))
    .filter((analysis): analysis is MoveAnalysis => Boolean(analysis))
    .sort((a, b) => (
      b.rank - a.rank
      || b.scoreEstimate - a.scoreEstimate
      || canonicalPosition(a.swap.from).localeCompare(canonicalPosition(b.swap.from))
      || canonicalPosition(a.swap.to).localeCompare(canonicalPosition(b.swap.to))
    ));
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : analyses.length;
  return Object.freeze(analyses.slice(0, boundedLimit));
}

export function exportReplay(state: MindGameState): ReplayBundle {
  return Object.freeze({
    version: ENGINE_VERSION,
    seed: state.seed,
    config: freezeConfig(state.config),
    moves: Object.freeze(state.history.map((record) => freezeSwap(record.swap))),
    fingerprints: Object.freeze(state.history.map((record) => record.afterHash)),
  });
}

export function replayGame(bundle: ReplayBundle): MindGameState {
  if (bundle.version !== ENGINE_VERSION) throw new Error('This replay uses an unsupported engine version.');
  let state = createGame({ seed: bundle.seed, config: bundle.config });
  bundle.moves.forEach((swap, index) => {
    const next = applyMove(state, swap);
    if (next === state) throw new Error(`Replay contains an invalid move at turn ${index + 1}.`);
    const expected = bundle.fingerprints[index];
    if (expected && stateFingerprint(next) !== expected) {
      throw new Error(`Replay diverged at turn ${index + 1}.`);
    }
    state = next;
  });
  return state;
}

export function replayTurns(initialState: MindGameState, records: ReadonlyArray<TurnRecord>): MindGameState {
  let state = initialState;
  records.forEach((record, index) => {
    if (stateFingerprint(state) !== record.beforeHash) {
      throw new Error(`Turn record ${index + 1} does not match the supplied state.`);
    }
    const next = applyMove(state, record.swap);
    if (next === state || stateFingerprint(next) !== record.afterHash) {
      throw new Error(`Turn record ${index + 1} could not be reproduced.`);
    }
    state = next;
  });
  return state;
}
