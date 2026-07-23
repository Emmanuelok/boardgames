import type {
  BoardView,
  Difficulty,
  GameDefinition,
  GameStatus,
  MoveBase,
  MoveExplanation,
  MoveInsight,
  Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Mū Tōrere — a traditional Māori strategy game from Aotearoa New Zealand.
 *
 * The board has eight outer points arranged in a ring and one central point.
 * Each player starts with four stones on a continuous half of the ring. A stone
 * may slide to a neighbouring empty ring point. A stone in the centre may move
 * to any empty ring point. A ring stone may enter the empty centre only when at
 * least one of its two ring neighbours is an opposing stone. A player with no
 * legal move loses.
 *
 * We map the star to a 3×3 renderer:
 *
 *   0 — 1 — 2
 *   | \ | / |
 *   3 — 4 — 5       4 is the centre; [0,1,2,5,8,7,6,3] is the ring.
 *   | / | \ |
 *   6 — 7 — 8
 *
 * The position history implements threefold-repetition protection and the
 * generous ply cap is a final safety net for unattended deterministic games.
 */

const CENTRE = 4;
const RING = [0, 1, 2, 5, 8, 7, 6, 3] as const;
const RING_SET = new Set<number>(RING);
const DRAW_PLY = 160;
const REPETITIONS_TO_DRAW = 3;

const POINT_NAMES: Record<number, string> = {
  0: 'NW',
  1: 'N',
  2: 'NE',
  3: 'W',
  4: 'Pūtahi',
  5: 'E',
  6: 'SW',
  7: 'S',
  8: 'SE',
};

const RING_INDEX = new Map<number, number>(RING.map((point, index) => [point, index]));

function ringNeighbours(point: number): [number, number] {
  const ringIndex = RING_INDEX.get(point);
  if (ringIndex === undefined) throw new Error(`Point ${point} is not on the Mū Tōrere ring`);
  return [
    RING[(ringIndex + RING.length - 1) % RING.length],
    RING[(ringIndex + 1) % RING.length],
  ];
}

export const CONNECTIONS: Array<[number, number]> = (() => {
  const connections: Array<[number, number]> = [];
  for (let index = 0; index < RING.length; index++) {
    connections.push([RING[index], RING[(index + 1) % RING.length]]);
    connections.push([RING[index], CENTRE]);
  }
  return connections;
})();

export interface MuTorereState {
  board: Array<Player | null>;
  turn: Player;
  ply: number;
  /** Position keys, including the current position. */
  history: string[];
}

export interface MuTorereMove extends MoveBase {}

export function positionKey(board: Array<Player | null>, turn: Player): string {
  return `${board.map((piece) => (piece === null ? '.' : piece)).join('')}:${turn}`;
}

function currentRepetitionCount(state: MuTorereState): number {
  const key = positionKey(state.board, state.turn);
  let count = 0;
  for (const seen of state.history) if (seen === key) count++;
  return count;
}

export function createInitialState(): MuTorereState {
  const board: Array<Player | null> = Array(9).fill(null);
  for (let index = 0; index < 4; index++) board[RING[index]] = 0;
  for (let index = 4; index < RING.length; index++) board[RING[index]] = 1;
  const state: MuTorereState = { board, turn: 0, ply: 0, history: [] };
  state.history.push(positionKey(state.board, state.turn));
  return state;
}

function cloneState(state: MuTorereState): MuTorereState {
  return {
    board: state.board.slice(),
    turn: state.turn,
    ply: state.ply,
    history: state.history.slice(),
  };
}

function makeMove(from: number, to: number): MuTorereMove {
  return {
    id: `${from}-${to}`,
    from,
    to,
    notation: `${POINT_NAMES[from]}–${POINT_NAMES[to]}`,
  };
}

/** Generate rules-legal moves without applying repetition or ply-cap status. */
export function rawLegalMoves(
  board: Array<Player | null>,
  player: Player,
  fromCell?: number | null,
): MuTorereMove[] {
  const opponent = (player ^ 1) as Player;
  const moves: MuTorereMove[] = [];

  for (let from = 0; from < board.length; from++) {
    if (board[from] !== player || (fromCell != null && from !== fromCell)) continue;

    if (from === CENTRE) {
      for (const to of RING) if (board[to] === null) moves.push(makeMove(from, to));
      continue;
    }

    if (!RING_SET.has(from)) continue;
    const neighbours = ringNeighbours(from);
    for (const to of neighbours) {
      if (board[to] === null) moves.push(makeMove(from, to));
    }

    const touchesOpponent = neighbours.some((point) => board[point] === opponent);
    if (board[CENTRE] === null && touchesOpponent) moves.push(makeMove(from, CENTRE));
  }

  return moves.sort((left, right) => left.id.localeCompare(right.id));
}

type Outcome = Player | 'draw' | null;

export function outcomeOf(state: MuTorereState): Outcome {
  if (rawLegalMoves(state.board, state.turn).length === 0) return (state.turn ^ 1) as Player;
  if (currentRepetitionCount(state) >= REPETITIONS_TO_DRAW) return 'draw';
  if (state.ply >= DRAW_PLY) return 'draw';
  return null;
}

export function legalMoves(state: MuTorereState, fromCell?: number | null): MuTorereMove[] {
  if (outcomeOf(state) !== null) return [];
  return rawLegalMoves(state.board, state.turn, fromCell);
}

export function applyMove(state: MuTorereState, move: MuTorereMove): MuTorereState {
  const board = state.board.slice();
  board[move.from!] = null;
  board[move.to] = state.turn;
  const turn = (state.turn ^ 1) as Player;
  return {
    board,
    turn,
    ply: state.ply + 1,
    history: [...state.history, positionKey(board, turn)],
  };
}

function movablePieces(board: Array<Player | null>, player: Player): number {
  const sources = new Set(rawLegalMoves(board, player).map((move) => move.from));
  return sources.size;
}

function immediateWins(board: Array<Player | null>, player: Player): number {
  let wins = 0;
  for (const move of rawLegalMoves(board, player)) {
    const next = board.slice();
    next[move.from!] = null;
    next[move.to] = player;
    if (rawLegalMoves(next, (player ^ 1) as Player).length === 0) wins++;
  }
  return wins;
}

/**
 * Static evaluation, positive for Kōwhai (player 0).
 *
 * Blocking threats dominate; then mobility, the number of independently
 * movable stones, access to the centre, and centre control break ties.
 */
export function evaluate(state: MuTorereState): number {
  const outcome = outcomeOf(state);
  if (outcome === 0) return WIN;
  if (outcome === 1) return -WIN;
  if (outcome === 'draw') return 0;

  const mobility0 = rawLegalMoves(state.board, 0).length;
  const mobility1 = rawLegalMoves(state.board, 1).length;
  const pieces0 = movablePieces(state.board, 0);
  const pieces1 = movablePieces(state.board, 1);
  const wins0 = immediateWins(state.board, 0);
  const wins1 = immediateWins(state.board, 1);

  let score = (wins0 - wins1) * 420;
  score += (mobility0 - mobility1) * 22;
  score += (pieces0 - pieces1) * 11;
  if (state.board[CENTRE] === 0) score += 18;
  else if (state.board[CENTRE] === 1) score -= 18;

  // Having two legal choices is materially safer than being forced along the
  // ring, so reward the side that can preserve alternatives.
  if (mobility0 >= 2) score += 7;
  if (mobility1 >= 2) score -= 7;
  return score;
}

/* --------------------------- Perfect-play tablebase ---------------------- */

type TablebaseStatus = 'win' | 'loss' | 'draw';
interface TablebaseEntry {
  /** Result from the perspective of the side to move. */
  status: TablebaseStatus;
  /** Plies to a forced result for win/loss entries. */
  distance: number;
}

interface BarePosition {
  board: Array<Player | null>;
  turn: Player;
}

function enumeratePositions(): BarePosition[] {
  const positions: BarePosition[] = [];
  for (let empty = 0; empty < 9; empty++) {
    const occupied = Array.from({ length: 9 }, (_, index) => index).filter((index) => index !== empty);
    for (let mask = 0; mask < 1 << occupied.length; mask++) {
      let zeroes = 0;
      for (let bit = 0; bit < occupied.length; bit++) if (mask & (1 << bit)) zeroes++;
      if (zeroes !== 4) continue;
      const board: Array<Player | null> = Array(9).fill(1);
      board[empty] = null;
      for (let bit = 0; bit < occupied.length; bit++) {
        if (mask & (1 << bit)) board[occupied[bit]] = 0;
      }
      positions.push({ board, turn: 0 }, { board: board.slice(), turn: 1 });
    }
  }
  return positions;
}

function applyBare(position: BarePosition, move: MuTorereMove): BarePosition {
  const board = position.board.slice();
  board[move.from!] = null;
  board[move.to] = position.turn;
  return { board, turn: (position.turn ^ 1) as Player };
}

function buildTablebase(): Map<string, TablebaseEntry> {
  const positions = enumeratePositions();
  const byKey = new Map(positions.map((position) => [positionKey(position.board, position.turn), position]));
  const children = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const [key, position] of byKey) {
    const nextKeys = rawLegalMoves(position.board, position.turn).map((move) => {
      const next = applyBare(position, move);
      return positionKey(next.board, next.turn);
    });
    children.set(key, nextKeys);
    for (const child of nextKeys) {
      const list = predecessors.get(child);
      if (list) list.push(key);
      else predecessors.set(child, [key]);
    }
  }

  const solved = new Map<string, TablebaseEntry>();
  const resolvedWinningChildren = new Map<string, number>();
  const longestWinningChild = new Map<string, number>();
  const queue: string[] = [];

  for (const key of byKey.keys()) {
    if ((children.get(key)?.length ?? 0) === 0) {
      solved.set(key, { status: 'loss', distance: 0 });
      queue.push(key);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const childKey = queue[cursor];
    const child = solved.get(childKey)!;
    for (const predecessorKey of predecessors.get(childKey) ?? []) {
      if (solved.has(predecessorKey)) continue;

      // A move to an opponent loss proves this position is a win.
      if (child.status === 'loss') {
        solved.set(predecessorKey, { status: 'win', distance: child.distance + 1 });
        queue.push(predecessorKey);
        continue;
      }

      // Only when every move gives the opponent a win is this position a loss.
      if (child.status === 'win') {
        const count = (resolvedWinningChildren.get(predecessorKey) ?? 0) + 1;
        resolvedWinningChildren.set(predecessorKey, count);
        longestWinningChild.set(
          predecessorKey,
          Math.max(longestWinningChild.get(predecessorKey) ?? 0, child.distance),
        );
        if (count === (children.get(predecessorKey)?.length ?? 0)) {
          solved.set(predecessorKey, {
            status: 'loss',
            distance: (longestWinningChild.get(predecessorKey) ?? 0) + 1,
          });
          queue.push(predecessorKey);
        }
      }
    }
  }

  for (const key of byKey.keys()) {
    if (!solved.has(key)) solved.set(key, { status: 'draw', distance: 0 });
  }
  return solved;
}

const TABLEBASE = buildTablebase();

function tablebaseEntry(state: MuTorereState): TablebaseEntry | null {
  return TABLEBASE.get(positionKey(state.board, state.turn)) ?? null;
}

function masterRank(state: MuTorereState, move: MuTorereMove): {
  move: MuTorereMove;
  result: -1 | 0 | 1;
  distance: number;
  shape: number;
} {
  const after = applyMove(state, move);
  const immediate = outcomeOf(after);
  let result: -1 | 0 | 1;
  let distance = 0;

  if (immediate === state.turn) result = 1;
  else if (immediate === 'draw') result = 0;
  else {
    const entry = tablebaseEntry(after);
    result = entry?.status === 'loss' ? 1 : entry?.status === 'win' ? -1 : 0;
    distance = entry?.distance ?? 0;
  }

  const shape = (state.turn === 0 ? 1 : -1) * evaluate(after);
  return { move, result, distance, shape };
}

function compareMasterRanks(
  left: ReturnType<typeof masterRank>,
  right: ReturnType<typeof masterRank>,
): number {
  if (left.result !== right.result) return right.result - left.result;
  if (left.result === 1 && left.distance !== right.distance) return left.distance - right.distance;
  if (left.result === -1 && left.distance !== right.distance) return right.distance - left.distance;
  if (left.shape !== right.shape) return right.shape - left.shape;
  return left.move.id.localeCompare(right.move.id);
}

function chooseMasterMove(state: MuTorereState): MuTorereMove | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  return moves.map((move) => masterRank(state, move)).sort(compareMasterRanks)[0].move;
}

const DEPTH: Record<Exclude<Difficulty, 'master'>, number> = {
  tutor: 10,
  easy: 2,
  medium: 5,
  hard: 8,
};
const RANDOMNESS: Record<Exclude<Difficulty, 'master'>, number> = {
  tutor: 0,
  easy: 0.8,
  medium: 0.3,
  hard: 0.04,
};

function searchAdapter() {
  return {
    getLegalMoves: (state: MuTorereState) => legalMoves(state),
    applyMove,
    getTurn: (state: MuTorereState) => state.turn,
    isTerminal: (state: MuTorereState) => outcomeOf(state) !== null,
    evaluate,
    order: (state: MuTorereState, move: MuTorereMove) => masterRank(state, move).result * 1_000
      + (move.to === CENTRE ? 25 : 0),
  };
}

function chooseMove(state: MuTorereState, difficulty: Difficulty): MuTorereMove | null {
  if (difficulty === 'master') return chooseMasterMove(state);
  const seed = state.board.reduce(
    (value, piece, index) => Math.imul(value ^ ((piece ?? 2) + 3) * (index + 11), 16777619),
    state.ply + state.turn + 2166136261,
  );
  return searchBestMove(state, searchAdapter(), DEPTH[difficulty], {
    randomness: RANDOMNESS[difficulty],
    rng: mulberry32(seed),
  }).move;
}

function getStatus(state: MuTorereState): GameStatus {
  const outcome = outcomeOf(state);
  if (outcome === 'draw') {
    if (currentRepetitionCount(state) >= REPETITIONS_TO_DRAW) {
      return { kind: 'draw', reason: 'the position repeated three times' };
    }
    return { kind: 'draw', reason: 'the safety move limit was reached' };
  }
  if (outcome !== null) {
    return { kind: 'win', winner: outcome, reason: 'the opponent has no legal move' };
  }
  return { kind: 'playing' };
}

function getBoardView(state: MuTorereState): BoardView {
  return {
    rows: 3,
    cols: 3,
    cells: state.board.map((piece, index) => ({
      index,
      row: Math.floor(index / 3),
      col: index % 3,
      playable: true,
      piece: piece === null
        ? null
        : { id: `mt-${piece}-${index}`, kind: 'stone', player: piece },
    })),
  };
}

function moveScoreForMover(state: MuTorereState, move: MuTorereMove): number {
  const rank = masterRank(state, move);
  const distanceBonus = rank.result === 1 ? -rank.distance : rank.result === -1 ? rank.distance : 0;
  return rank.result * 5_000 + distanceBonus * 4 + rank.shape;
}

function explainMove(
  before: MuTorereState,
  move: MuTorereMove,
  after: MuTorereState,
): MoveExplanation {
  const mover = before.turn;
  const candidates = legalMoves(before)
    .map((candidate) => ({ move: candidate, score: moveScoreForMover(before, candidate) }))
    .sort((left, right) => right.score - left.score || left.move.id.localeCompare(right.move.id));
  const playedScore = candidates.find((candidate) => candidate.move.id === move.id)?.score
    ?? ((mover === 0 ? 1 : -1) * evaluate(after));
  const bestScore = candidates[0]?.score ?? playedScore;
  const loss = Math.max(0, bestScore - playedScore);
  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;
  const beforeMobility = rawLegalMoves(before.board, (mover ^ 1) as Player).length;
  const afterMobility = rawLegalMoves(after.board, (mover ^ 1) as Player).length;
  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  if (won) {
    insights.push({
      tag: 'Complete blockade',
      detail: 'The opponent has no legal move, so the game ends immediately.',
      tone: 'good',
    });
    principles.push('A blockade is the only win: control the vacancy and close both of its ring neighbours.');
  } else if (move.to === CENTRE) {
    insights.push({
      tag: 'Enters the pūtahi',
      detail: 'This centre entry is legal because the departing stone touches an opposing stone on the ring.',
      tone: 'good',
    });
    principles.push('Centre access depends on contact: only a ring stone beside an opponent may enter.');
  } else if (move.from === CENTRE) {
    insights.push({
      tag: 'Leaves the pūtahi',
      detail: 'A centre stone may move to any empty outer point, resetting where the ring vacancy sits.',
      tone: 'info',
    });
    principles.push('Use the centre to relocate the vacancy without giving the opponent a trapping pattern.');
  } else {
    insights.push({
      tag: 'Ring slide',
      detail: 'The stone follows the ring into its neighbouring empty point.',
      tone: 'info',
    });
    principles.push('Every ring slide moves the vacancy too; study the two stones that will border it next.');
  }

  if (!won && afterMobility < beforeMobility) {
    insights.push({
      tag: 'Tightens the position',
      detail: `The opponent's legal choices fall from ${beforeMobility} to ${afterMobility}.`,
      tone: 'good',
    });
  } else if (afterMobility > beforeMobility) {
    insights.push({
      tag: 'Opens options',
      detail: `The opponent now has ${afterMobility} legal choices.`,
      tone: 'bad',
    });
  }

  const opponentWins = immediateWins(after.board, after.turn);
  if (!won && opponentWins > 0) {
    threats.push('The opponent has a move that can complete a blockade immediately.');
    insights.push({
      tag: 'Blockade warning',
      detail: 'The reply must be checked carefully: an immediate trap is available.',
      tone: 'bad',
    });
  }

  const rank = masterRank(before, move);
  if (!won && rank.result === 0) {
    insights.push({
      tag: 'Holds the balance',
      detail: 'The perfect-play tablebase keeps this position in the drawable zone.',
      tone: 'good',
    });
  } else if (!won && rank.result === -1) {
    insights.push({
      tag: 'Loses with perfect reply',
      detail: 'The tablebase finds a forced blockade for the opponent from here.',
      tone: 'bad',
    });
  }

  const band = won ? 'best' : gradeByLoss(loss, Math.abs(playedScore) > 2_000);
  const best = candidates[0]?.move;
  return {
    summary: won
      ? `${def.players[mover].name} closes the ring and wins by blockade.`
      : `${def.players[mover].name} plays ${move.notation}.`,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length > 0 ? threats : undefined,
    betterIdea: loss > 60 && best && best.id !== move.id
      ? `The tablebase prefers ${best.notation}.`
      : undefined,
  };
}

function hint(state: MuTorereState): { move: MuTorereMove; text: string } | null {
  const move = chooseMasterMove(state);
  if (!move) return null;
  const after = applyMove(state, move);
  const status = getStatus(after);
  if (status.kind === 'win' && status.winner === state.turn) {
    return { move, text: `${move.notation} leaves the opponent without a legal move — complete the blockade.` };
  }
  if (move.to === CENTRE) {
    return { move, text: `${move.notation} uses a legal centre entry and preserves your strongest options.` };
  }
  if (move.from === CENTRE) {
    return { move, text: `${move.notation} relocates the vacancy while keeping the ring defensible.` };
  }
  const replies = rawLegalMoves(after.board, after.turn).length;
  return {
    move,
    text: `${move.notation} shifts the vacancy and holds the opponent to ${replies} legal ${replies === 1 ? 'reply' : 'replies'}.`,
  };
}

function deserialize(serialized: string): MuTorereState {
  const parsed = JSON.parse(serialized) as Partial<MuTorereState>;
  if (!Array.isArray(parsed.board) || parsed.board.length !== 9
    || parsed.board.some((piece) => piece !== null && piece !== 0 && piece !== 1)
    || (parsed.turn !== 0 && parsed.turn !== 1)) {
    throw new Error('Invalid Mū Tōrere position');
  }
  const board = parsed.board.slice() as Array<Player | null>;
  if (board.filter((piece) => piece === 0).length !== 4
    || board.filter((piece) => piece === 1).length !== 4
    || board.filter((piece) => piece === null).length !== 1) {
    throw new Error('Invalid Mū Tōrere position');
  }
  const turn = parsed.turn;
  const ply = Number.isFinite(parsed.ply) && (parsed.ply ?? 0) >= 0
    ? Math.floor(parsed.ply ?? 0)
    : 0;
  const history = Array.isArray(parsed.history)
    ? parsed.history.filter((key): key is string => typeof key === 'string')
    : [];
  const key = positionKey(board, turn);
  if (history.length === 0 || history[history.length - 1] !== key) history.push(key);
  return { board, turn, ply, history };
}

const challengeState = JSON.stringify({
  board: [0, 0, null, 1, 0, 1, 1, 0, 1],
  turn: 0,
  ply: 18,
});

const def: GameDefinition<MuTorereState, MuTorereMove> = {
  id: 'mu-torere',
  name: 'Mū Tōrere',
  tagline: 'Guide the single vacancy around the ring, command the centre, and seal a blockade.',
  blurb:
    'A traditional Māori strategy game from Aotearoa New Zealand, played with four stones each on an eight-point ring around a centre. Nothing is captured: every move transfers the board’s single vacancy, and the centre can only be entered from a ring stone beside an opponent. Win by shaping the ring so the other player has no legal move. Nine points and one empty space create a remarkably exact contest of timing, contact and restraint.',
  category: 'Strategy',
  depth: 3,
  emoji: '✦',
  accent: '#14b8a6',
  players: [
    { id: 0, name: 'Kōwhai', short: 'K', color: '#eab308' },
    { id: 1, name: 'Kikorangi', short: 'I', color: '#2563eb' },
  ],
  interaction: { type: 'move' },
  render: {
    pieceStyle: 'stone',
    showCoordinates: false,
    checkered: false,
    connections: CONNECTIONS,
  },
  evalScale: 120,

  createInitialState,
  cloneState,
  getBoardView,
  getTurn: (state) => state.turn,
  getStatus,
  getLegalMoves: legalMoves,
  applyMove,
  chooseMove,
  evaluate,
  explainMove,
  hint,
  serialize: (state) => JSON.stringify(state),
  deserialize,

  tutorial: {
    overview:
      'Mū Tōrere is a traditional Māori strategy game from Aotearoa New Zealand. Its board is an eight-point outer ring around one centre point. The outer points are commonly called the **kewai**, and the centre the **pūtahi**. This lesson focuses on respectful, rules-based play: two equal groups of four stones, no captures, and one shared vacancy whose location determines every possibility.',
    objective:
      'Leave the opponent with no legal move. A ring stone may slide to a neighbouring empty ring point. A stone in the pūtahi may move to any empty ring point. A ring stone may enter the empty pūtahi only when one of that stone’s two ring neighbours is an opponent. Stones never jump or capture. Repeated positions are drawn in this digital version so training games always conclude.',
    chapters: [
      {
        title: 'Board and movement',
        icon: '✦',
        steps: [
          {
            title: 'Nine connected points',
            body: 'The board has **eight kewai around a ring** and one central **pūtahi**. Each player begins with four stones occupying one continuous half of the ring; the pūtahi begins empty. Kōwhai moves first.',
            setup: JSON.stringify(createInitialState()),
            highlight: [...RING, CENTRE],
          },
          {
            title: 'Follow the ring',
            body: 'A stone on the ring may slide to an **adjacent empty ring point**. It cannot skip a point or cross the ring. Because there is only one empty point, every ring slide also moves the vacancy to the stone’s former position.',
            arrows: [{ from: 1, to: 2, tone: 'good' }],
          },
          {
            title: 'The pūtahi entry rule',
            body: 'A ring stone may enter the empty **pūtahi only if that stone is next to an opposing stone on the ring**. This contact rule is essential: a stone surrounded by friendly neighbours cannot enter the centre. A stone already in the pūtahi may move out to any empty ring point.',
            setup: JSON.stringify(createInitialState()),
            arrows: [
              { from: 0, to: CENTRE, tone: 'good' },
              { from: 1, to: CENTRE, tone: 'bad' },
              { from: 5, to: CENTRE, tone: 'good' },
            ],
          },
          {
            title: 'Win by blockade',
            body: 'There are no captures and no scoring lines. You win only by leaving the other player **without a legal move**. This happens when your stone holds the pūtahi while your stones occupy both ring points beside the vacancy.',
            setup: challengeState,
            highlight: [CENTRE, 0, 1, 2],
          },
        ],
      },
      {
        title: 'Vacancy strategy',
        icon: '🧭',
        steps: [
          {
            title: 'Read the empty point first',
            body: 'Before choosing a stone, find the vacancy. On the ring, inspect its two neighbours and ask what the vacancy will border **after** your slide. The strongest move is often determined by the empty point rather than by the stone that moves.',
          },
          {
            title: 'Keep centre access alive',
            body: 'A block of friendly stones can lose contact with the opponent and therefore lose access to the pūtahi. Preserve at least one boundary stone beside an opponent unless a concrete blockade is ready.',
          },
          {
            title: 'The centre relocates the vacancy',
            body: 'When your stone occupies the pūtahi, it can move to the empty ring point. That exchange places the vacancy in the centre again and changes which boundary stones may enter. Use this tempo to avoid being funnelled into a forced ring cycle.',
          },
          {
            title: 'Perfect play and repetition',
            body: 'The opening position is balanced under perfect play. The Master opponent uses a complete small-board tablebase to preserve a draw or convert a mistake into a blockade. The digital threefold rule recognises harmless cycles instead of letting a practice game continue indefinitely.',
          },
        ],
      },
      {
        title: 'Guided blockade',
        icon: '🎯',
        steps: [
          {
            title: 'Close the northern gate',
            body: 'Kōwhai controls the pūtahi and the northwest point. The northeast point is empty. Two moves can fill it, but only one moves the vacancy between two Kōwhai stones and leaves Kikorangi completely blocked.',
            setup: challengeState,
            challenge: {
              prompt: 'Kōwhai to move — find the ring slide that completes the blockade.',
              solution: ['N–NE'],
              success: 'N–NE is exact. The new vacancy at N is bordered by Kōwhai stones at NW and NE, while Kōwhai still holds the pūtahi. Kikorangi has no legal move.',
            },
          },
          {
            title: 'Train with exact feedback',
            body: 'During full games, the tutor identifies legal centre entries, vacancy control, immediate blockade threats and moves that leave the perfect-play drawing zone. Raise the opponent to **Master** to practise against the built-in complete-position tablebase.',
          },
        ],
      },
    ],
  },
};

export default def;
