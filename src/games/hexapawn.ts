import type {
  BoardView,
  Difficulty,
  GameDefinition,
  GameStatus,
  MoveBase,
  MoveExplanation,
  Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Hexapawn distils chess-pawn strategy onto a 3×3 board. Each side starts with
 * three pawns. A pawn advances one empty square straight ahead or captures one
 * enemy pawn diagonally ahead. There are no double steps and no promotions:
 * reaching the far rank wins immediately. A player also wins when the opponent
 * has no legal move.
 *
 * Board indices are row-major. Row 0 is rank 3 at the top; player 0 starts on
 * rank 1 and moves upward, while player 1 starts on rank 3 and moves downward.
 */

const SIZE = 3;
const CELL_COUNT = SIZE * SIZE;
const FILES = ['a', 'b', 'c'];
const RANKS = ['3', '2', '1'];

export interface HexapawnState {
  board: (Player | null)[];
  turn: Player;
}

export interface HexapawnMove extends MoveBase {
  from: number;
}

const rowOf = (cell: number) => Math.floor(cell / SIZE);
const colOf = (cell: number) => cell % SIZE;
const indexOf = (row: number, col: number) => row * SIZE + col;
const inBounds = (row: number, col: number) =>
  row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const opponent = (player: Player) => (player ^ 1) as Player;
const directionOf = (player: Player) => (player === 0 ? -1 : 1);
const goalRowOf = (player: Player) => (player === 0 ? 0 : SIZE - 1);
const squareName = (cell: number) => `${FILES[colOf(cell)]}${SIZE - rowOf(cell)}`;

export function createInitialState(): HexapawnState {
  return {
    board: [1, 1, 1, null, null, null, 0, 0, 0],
    turn: 0,
  };
}

function hasReachedGoal(board: (Player | null)[], player: Player): boolean {
  const goal = goalRowOf(player);
  return FILES.some((_, col) => board[indexOf(goal, col)] === player);
}

function makeMove(from: number, to: number, capture: boolean): HexapawnMove {
  return {
    id: `${from}-${to}`,
    from,
    to,
    capture,
    affected: capture ? [to] : undefined,
    notation: `${squareName(from)}${capture ? 'x' : '-'}${squareName(to)}`,
  };
}

/**
 * Generate moves without consulting terminal status. Keeping this primitive
 * separate lets status and evaluation detect a no-move win without recursion.
 */
function generateMoves(
  state: HexapawnState,
  fromCell?: number | null,
): HexapawnMove[] {
  const player = state.turn;
  const enemy = opponent(player);
  const direction = directionOf(player);
  const moves: HexapawnMove[] = [];

  for (let from = 0; from < CELL_COUNT; from++) {
    if (state.board[from] !== player) continue;
    if (fromCell != null && from !== fromCell) continue;

    const row = rowOf(from);
    const col = colOf(from);
    const nextRow = row + direction;
    if (!inBounds(nextRow, col)) continue;

    const straight = indexOf(nextRow, col);
    if (state.board[straight] === null) {
      moves.push(makeMove(from, straight, false));
    }

    for (const deltaCol of [-1, 1]) {
      const nextCol = col + deltaCol;
      if (!inBounds(nextRow, nextCol)) continue;
      const target = indexOf(nextRow, nextCol);
      if (state.board[target] === enemy) {
        moves.push(makeMove(from, target, true));
      }
    }
  }

  return moves;
}

function goalWinner(state: HexapawnState): Player | null {
  const first = hasReachedGoal(state.board, 0);
  const second = hasReachedGoal(state.board, 1);
  if (first && second) return opponent(state.turn);
  if (first) return 0;
  if (second) return 1;
  return null;
}

function winnerOf(state: HexapawnState): Player | null {
  const winner = goalWinner(state);
  if (winner !== null) return winner;
  return generateMoves(state).length === 0 ? opponent(state.turn) : null;
}

function legalMoves(
  state: HexapawnState,
  fromCell?: number | null,
): HexapawnMove[] {
  if (goalWinner(state) !== null) return [];
  return generateMoves(state, fromCell);
}

function applyMove(state: HexapawnState, move: HexapawnMove): HexapawnState {
  const canonical = legalMoves(state, move.from).find(
    (candidate) => candidate.to === move.to,
  );
  if (!canonical) {
    throw new Error(`Illegal Hexapawn move: ${move.id}`);
  }

  const board = state.board.slice();
  board[canonical.from] = null;
  board[canonical.to] = state.turn;
  return { board, turn: opponent(state.turn) };
}

function advancement(cell: number, player: Player): number {
  return player === 0 ? SIZE - 1 - rowOf(cell) : rowOf(cell);
}

function immediateWinningMoves(state: HexapawnState, player: Player): number {
  const playerState: HexapawnState = { board: state.board, turn: player };
  return generateMoves(playerState).filter(
    (move) => rowOf(move.to) === goalRowOf(player),
  ).length;
}

/**
 * Static evaluation, positive for Ivory (player 0). Material matters, but on
 * this tiny board tempo, a clear path and an immediate far-rank threat matter
 * more. Full-strength profiles search the complete practical game tree.
 */
export function evaluate(state: HexapawnState): number {
  const winner = winnerOf(state);
  if (winner === 0) return WIN;
  if (winner === 1) return -WIN;

  let score = 0;
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const player = state.board[cell];
    if (player === null) continue;

    const sign = player === 0 ? 1 : -1;
    let value = 120 + advancement(cell, player) * 42;
    if (colOf(cell) === 1) value += 9;

    const nextRow = rowOf(cell) + directionOf(player);
    if (inBounds(nextRow, colOf(cell))) {
      const directlyAhead = state.board[indexOf(nextRow, colOf(cell))];
      if (directlyAhead === opponent(player)) value -= 28;
      if (directlyAhead === null) value += 12;
    }
    score += sign * value;
  }

  const moves0 = generateMoves({ board: state.board, turn: 0 }).length;
  const moves1 = generateMoves({ board: state.board, turn: 1 }).length;
  score += (moves0 - moves1) * 7;
  score +=
    (immediateWinningMoves(state, 0) - immediateWinningMoves(state, 1)) * 280;

  return score;
}

function searchAdapter() {
  return {
    getLegalMoves: (state: HexapawnState) => legalMoves(state),
    applyMove,
    getTurn: (state: HexapawnState) => state.turn,
    isTerminal: (state: HexapawnState) => winnerOf(state) !== null,
    evaluate,
    order: (state: HexapawnState, move: HexapawnMove) => {
      const reachesGoal =
        rowOf(move.to) === goalRowOf(state.turn) ? 10_000 : 0;
      return reachesGoal + (move.capture ? 1_000 : 0) +
        advancement(move.to, state.turn) * 20 +
        (colOf(move.to) === 1 ? 3 : 0);
    },
  };
}

const AI_PROFILE: Record<
  Difficulty,
  { depth: number; randomness: number }
> = {
  easy: { depth: 1, randomness: 0.9 },
  medium: { depth: 3, randomness: 0.32 },
  hard: { depth: 7, randomness: 0.04 },
  master: { depth: 12, randomness: 0 },
  tutor: { depth: 12, randomness: 0 },
};

function stateSeed(state: HexapawnState): number {
  let hash = 2166136261;
  for (const occupant of state.board) {
    hash ^= occupant === null ? 3 : occupant + 1;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= state.turn + 17;
  return hash >>> 0;
}

function chooseMove(
  state: HexapawnState,
  difficulty: Difficulty,
): HexapawnMove | null {
  const profile = AI_PROFILE[difficulty];
  return searchBestMove(state, searchAdapter(), profile.depth, {
    randomness: profile.randomness,
    rng: mulberry32(stateSeed(state)),
  }).move;
}

function getStatus(state: HexapawnState): GameStatus {
  const winner = winnerOf(state);
  if (winner === null) return { kind: 'playing' };
  if (hasReachedGoal(state.board, winner)) {
    return { kind: 'win', winner, reason: 'reached the far rank' };
  }
  return {
    kind: 'win',
    winner,
    reason: 'opponent has no legal move',
  };
}

function getBoardView(state: HexapawnState): BoardView {
  return {
    rows: SIZE,
    cols: SIZE,
    cells: state.board.map((player, index) => ({
      index,
      row: rowOf(index),
      col: colOf(index),
      piece:
        player === null
          ? null
          : {
              id: `hexapawn-${index}-${player}`,
              kind: 'P',
              player,
            },
    })),
    fileLabels: FILES.slice(),
    rankLabels: RANKS.slice(),
  };
}

function explainMove(
  before: HexapawnState,
  move: HexapawnMove,
  after: HexapawnState,
): MoveExplanation {
  const mover = before.turn;
  const search = searchBestMove(before, searchAdapter(), AI_PROFILE.tutor.depth);
  const fromMover = (score: number) => (mover === 0 ? score : -score);
  const fallback = fromMover(evaluate(after));
  const best = search.ranked.length
    ? fromMover(search.ranked[0].score)
    : fallback;
  const played = fromMover(
    search.ranked.find((candidate) => candidate.move.id === move.id)?.score ??
      evaluate(after),
  );
  const loss = Math.max(0, best - played);
  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;
  const insights: MoveExplanation['insights'] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  if (won && hasReachedGoal(after.board, mover)) {
    insights.push({
      tag: 'Far rank reached',
      detail: 'The pawn completes its journey, so the game ends immediately.',
      tone: 'good',
    });
  } else if (won) {
    insights.push({
      tag: 'Position locked',
      detail: 'Every opposing pawn is blocked and has no legal capture.',
      tone: 'good',
    });
  }

  if (move.capture) {
    insights.push({
      tag: 'Diagonal capture',
      detail: 'Takes an opposing pawn while advancing one rank.',
      tone: 'good',
    });
    principles.push(
      'A capture changes both material and the race; count the resulting moves for each side.',
    );
  } else {
    insights.push({
      tag: 'Straight advance',
      detail: 'Moves into an empty square while preserving both diagonal capture options.',
      tone: 'info',
    });
  }

  if (!won) {
    const futureWins = immediateWinningMoves(after, mover);
    if (futureWins > 0) {
      insights.push({
        tag: 'Far-rank threat',
        detail: `Creates ${futureWins === 1 ? 'a route' : 'multiple routes'} to win on the next turn.`,
        tone: 'good',
      });
      threats.push('A pawn is one legal move from the far rank.');
    }

    const opponentWins = legalMoves(after).filter((reply) => {
      const replyState = applyMove(after, reply);
      const replyStatus = getStatus(replyState);
      return replyStatus.kind === 'win' && replyStatus.winner === after.turn;
    });
    if (opponentWins.length > 0) {
      insights.push({
        tag: 'Immediate reply',
        detail: 'The opponent can finish the race on the next move.',
        tone: 'bad',
      });
      threats.push(`Watch ${opponentWins[0].notation}.`);
    }
  }

  if (principles.length === 0) {
    principles.push(
      'Before moving, compare your far-rank route with the opponent’s fastest route.',
    );
  }

  const band = won ? 'best' : gradeByLoss(loss, Math.abs(played) > 500);
  const summary = won
    ? `${def.players[mover].name} wins with ${move.notation}.`
    : move.capture
      ? `${def.players[mover].name} captures with ${move.notation}.`
      : `${def.players[mover].name} advances with ${move.notation}.`;
  const betterIdea =
    loss > 55 && search.move && search.move.id !== move.id
      ? `A stronger move was ${search.move.notation}.`
      : undefined;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea,
  };
}

function hint(
  state: HexapawnState,
): { move: HexapawnMove; text: string } | null {
  const move = chooseMove(state, 'tutor');
  if (!move) return null;
  const after = applyMove(state, move);
  const status = getStatus(after);

  if (status.kind === 'win' && status.winner === state.turn) {
    return {
      move,
      text:
        status.reason === 'reached the far rank'
          ? `${move.notation} reaches the far rank and wins immediately.`
          : `${move.notation} leaves the opponent without a legal move.`,
    };
  }
  if (move.capture) {
    return {
      move,
      text: `${move.notation} improves the race by capturing diagonally while advancing.`,
    };
  }
  return {
    move,
    text: `${move.notation} is the strongest advance: it improves your route while limiting the reply.`,
  };
}

function serialize(state: HexapawnState): string {
  return JSON.stringify({ board: state.board, turn: state.turn });
}

function deserialize(serialized: string): HexapawnState {
  const parsed: unknown = JSON.parse(serialized);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('board' in parsed) ||
    !('turn' in parsed)
  ) {
    throw new Error('Invalid Hexapawn state');
  }

  const candidate = parsed as { board: unknown; turn: unknown };
  if (
    !Array.isArray(candidate.board) ||
    candidate.board.length !== CELL_COUNT ||
    !candidate.board.every(
      (cell) => cell === null || cell === 0 || cell === 1,
    ) ||
    (candidate.turn !== 0 && candidate.turn !== 1)
  ) {
    throw new Error('Invalid Hexapawn state');
  }

  return {
    board: candidate.board.slice() as (Player | null)[],
    turn: candidate.turn,
  };
}

const def: GameDefinition<HexapawnState, HexapawnMove> = {
  id: 'hexapawn',
  name: 'Hexapawn',
  tagline: 'Nine squares, six pawns, and no wasted move.',
  blurb:
    'Hexapawn compresses the logic of pawn endings into a tiny, exact strategy game. Advance into open space, capture only on the forward diagonal, race for the far rank, or construct a blockade that leaves the other side without a move. Its board is small enough to study completely, yet every turn teaches calculation, opposition, tempo and the consequences of changing a pawn structure.',
  category: 'Strategy',
  depth: 2,
  emoji: '♟',
  accent: '#38bdf8',
  players: [
    { id: 0, name: 'Ivory', short: 'I', color: '#f8fafc' },
    { id: 1, name: 'Onyx', short: 'O', color: '#111827' },
  ],
  interaction: { type: 'move' },
  render: {
    pieceStyle: 'chess',
    showCoordinates: true,
    checkered: true,
  },
  evalScale: 380,

  createInitialState,
  cloneState: (state) => ({
    board: state.board.slice(),
    turn: state.turn,
  }),
  getBoardView,
  getTurn: (state) => state.turn,
  getStatus,
  getLegalMoves: legalMoves,
  applyMove,
  chooseMove,
  evaluate,
  liveEval(state) {
    const winner = winnerOf(state);
    if (winner !== null) {
      return { score: winner === 0 ? WIN : -WIN, depth: 0 };
    }
    const result = searchBestMove(state, searchAdapter(), 12);
    return { score: Math.round(result.score), depth: 12 };
  },
  explainMove,
  hint,
  serialize,
  deserialize,

  tutorial: {
    overview:
      'Hexapawn is a complete lesson in forward-only strategy. The 3×3 board holds just three pawns per side, so there are no long openings to memorise. Instead, every turn asks a precise question: should you advance, capture, block, or preserve a diagonal? Because pawns never retreat, each decision permanently reshapes the position. That makes the game ideal for learning how an engine explores choices and how one tempo can decide a race.',
    objective:
      'Win in either of two ways: move one pawn onto the far rank, or leave the opponent with no legal move. Pawns go one square straight forward only when that square is empty. They capture one opposing pawn one square diagonally forward. They never move backward or sideways, never advance two squares, and never capture straight ahead.',
    chapters: [
      {
        title: 'Movement', icon: '♟',
        steps: [
          {
            title: 'The opening formation',
            body: 'Ivory begins across **rank 1** and moves upward. Onyx begins across **rank 3** and moves downward. **Ivory moves first.** With one empty rank between the armies, the opening has exactly three advances.',
            setup: '{"board":[1,1,1,null,null,null,0,0,0],"turn":0}',
            highlight: [0, 1, 2, 6, 7, 8],
          },
          {
            title: 'Advance into emptiness',
            body: 'A pawn moves **one square straight forward** only when the destination is empty. There is no opening double-step. A pawn cannot enter a square occupied by either colour.',
            setup: '{"board":[null,null,1,null,null,null,0,null,null],"turn":0}',
            arrows: [{ from: 6, to: 3, tone: 'good' }],
            highlight: [3, 6],
          },
          {
            title: 'Capture on the diagonal',
            body: 'A pawn captures an opposing pawn **one square diagonally forward**. It cannot move diagonally into an empty square and cannot capture the pawn directly ahead. This difference between moving and capturing creates every Hexapawn tactic.',
            setup: '{"board":[null,null,null,1,1,null,null,0,null],"turn":0}',
            arrows: [{ from: 7, to: 3, tone: 'good' }],
            highlight: [3, 4, 7],
          },
          {
            title: 'Forward means permanent',
            body: 'Pawns never move backward or sideways. Once a pawn leaves a square, that structure cannot be restored. Check the opponent’s capture diagonals before every advance.',
          },
        ],
      },
      {
        title: 'Winning Logic', icon: '◇',
        steps: [
          {
            title: 'Reach the far rank',
            body: 'A pawn wins the instant it arrives on the opponent’s starting rank. There is no promotion choice because the game ends at once. Always scan for a direct finish before considering quieter plans.',
          },
          {
            title: 'Build a blockade',
            body: 'You also win when the opponent begins a turn with **no legal move**. A pawn directly ahead acts as a roadblock because it cannot be captured straight. If the blocked pawn has no opposing pawn on either forward diagonal, it is completely stuck.',
            setup: '{"board":[null,null,null,null,1,null,null,0,null],"turn":0}',
            highlight: [4, 7],
          },
          {
            title: 'Count tempos',
            body: 'A tempo is one turn. Count how many turns your nearest pawn needs to reach the far rank, then count the opponent’s route. A capture can improve the count twice: it advances your pawn and removes one of theirs.',
          },
          {
            title: 'The centre changes more',
            body: 'A centre pawn can potentially capture toward either edge, while an edge pawn has only one diagonal. That extra choice often makes the centre flexible—but the correct move is still the one that wins the race or completes the blockade.',
          },
        ],
      },
      {
        title: 'Position Lab', icon: '🎯',
        steps: [
          {
            title: 'Finish the quiet route',
            body: 'Ivory has a pawn on a2. The square ahead is empty, and Onyx has no diagonal capture waiting. Select the pawn and complete the race.',
            setup: '{"board":[null,null,null,0,null,1,null,null,null],"turn":0}',
            challenge: {
              prompt: 'Ivory to move — reach the far rank in one move.',
              solution: ['a2-a3'],
              success: 'a2-a3 reaches the far rank. A direct finish takes priority over every other idea.',
            },
          },
          {
            title: 'Capture into the finish',
            body: 'The square directly ahead is occupied, so the pawn cannot advance there. Use the legal capture that also reaches the far rank.',
            setup: '{"board":[1,1,null,null,0,null,null,null,null],"turn":0}',
            challenge: {
              prompt: 'Ivory to move — capture onto the far rank.',
              solution: ['b2xa3'],
              success: 'b2xa3 obeys the pawn’s diagonal capture rule and ends the race immediately.',
            },
          },
          {
            title: 'Keep calculating',
            body: 'During a full game, the tutor explains whether a move improves the race, creates a far-rank threat, allows an immediate reply, or completes a blockade. Easy explores one move ahead; the strongest profiles calculate the complete practical game tree.',
          },
        ],
      },
    ],
  },
};

export default def;
