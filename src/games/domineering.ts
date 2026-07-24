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
 * Domineering on a practical 6×6 board.
 *
 * Vertical places north–south dominoes and Horizontal places west–east
 * dominoes. A covered cell can never be used again. The first player who
 * cannot place a domino loses, so every move is both useful space for you and
 * potential space denied to the other orientation.
 *
 * A move's `to` is its clickable anchor (top cell for Vertical, left cell for
 * Horizontal). `affected` always contains both cells covered by the domino.
 */

const SIZE = 6;
const CELL_COUNT = SIZE * SIZE;
const SERIAL_VERSION = 1;

const idx = (row: number, col: number) => row * SIZE + col;
const rowOf = (cell: number) => Math.floor(cell / SIZE);
const colOf = (cell: number) => cell % SIZE;
const square = (cell: number) =>
  `${String.fromCharCode(97 + colOf(cell))}${SIZE - rowOf(cell)}`;

export interface DomineeringState {
  board: (Player | null)[];
  turn: Player;
}

export interface DomineeringMove extends MoveBase {
  affected: [number, number];
}

export function initialState(): DomineeringState {
  return { board: Array(CELL_COUNT).fill(null), turn: 0 };
}

function secondCell(anchor: number, player: Player): number {
  return anchor + (player === 0 ? SIZE : 1);
}

function canPlace(board: (Player | null)[], anchor: number, player: Player): boolean {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= CELL_COUNT) return false;
  const row = rowOf(anchor);
  const col = colOf(anchor);
  if (player === 0 && row >= SIZE - 1) return false;
  if (player === 1 && col >= SIZE - 1) return false;
  const second = secondCell(anchor, player);
  return board[anchor] === null && board[second] === null;
}

export function generateMoves(
  board: (Player | null)[],
  player: Player,
): DomineeringMove[] {
  const orientation = player === 0 ? 'V' : 'H';
  const moves: DomineeringMove[] = [];
  for (let anchor = 0; anchor < CELL_COUNT; anchor++) {
    if (!canPlace(board, anchor, player)) continue;
    const second = secondCell(anchor, player);
    moves.push({
      id: `${orientation}${anchor}`,
      to: anchor,
      affected: [anchor, second],
      notation: `${orientation}${square(anchor)}-${square(second)}`,
    });
  }
  return moves;
}

function legalMoves(s: DomineeringState): DomineeringMove[] {
  return generateMoves(s.board, s.turn);
}

function apply(s: DomineeringState, move: DomineeringMove): DomineeringState {
  // Resolve the canonical move rather than trusting side-effect data supplied
  // by a caller. This keeps imported positions and UI actions from overwriting
  // a covered cell with a forged `affected` array.
  const canonical = legalMoves(s).find(
    (candidate) => candidate.id === move.id && candidate.to === move.to,
  );
  if (!canonical) throw new Error('Illegal Domineering placement');

  const board = s.board.slice();
  for (const cell of canonical.affected) board[cell] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

interface MobilityProfile {
  moves: number;
  footprint: number;
  flexibleCells: number;
}

/**
 * Count not only placements, but how broadly and flexibly those placements
 * span the remaining board. A cell present in two or more legal dominoes
 * provides alternate routes and is therefore strategically resilient.
 */
function mobilityProfile(board: (Player | null)[], player: Player): MobilityProfile {
  const moves = generateMoves(board, player);
  const useCount = new Uint8Array(CELL_COUNT);
  for (const move of moves) {
    useCount[move.affected[0]]++;
    useCount[move.affected[1]]++;
  }

  let footprint = 0;
  let flexibleCells = 0;
  for (const uses of useCount) {
    if (uses > 0) footprint++;
    if (uses > 1) flexibleCells++;
  }
  return { moves: moves.length, footprint, flexibleCells };
}

export function evaluate(s: DomineeringState): number {
  const currentMoves = generateMoves(s.board, s.turn);
  if (currentMoves.length === 0) return s.turn === 0 ? -WIN : WIN;

  const vertical = mobilityProfile(s.board, 0);
  const horizontal = mobilityProfile(s.board, 1);
  return (
    (vertical.moves - horizontal.moves) * 18
    + (vertical.footprint - horizontal.footprint) * 4
    + (vertical.flexibleCells - horizontal.flexibleCells) * 2
  );
}

const DEPTH: Record<Difficulty, number> = {
  tutor: 3,
  easy: 1,
  medium: 2,
  hard: 3,
  master: 4,
};

const RANDOMNESS: Record<Difficulty, number> = {
  tutor: 0,
  easy: 0.78,
  medium: 0.38,
  hard: 0.08,
  master: 0,
};

function searchAdapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove: apply,
    getTurn: (s: DomineeringState) => s.turn,
    isTerminal: (s: DomineeringState) => legalMoves(s).length === 0,
    evaluate,
    // Search the moves that preserve the mover's options first. This makes
    // alpha-beta pruning much more effective without changing the result.
    order: (s: DomineeringState, move: DomineeringMove) => {
      const after = apply(s, move);
      const score = evaluate(after);
      return s.turn === 0 ? score : -score;
    },
  };
}

function positionSeed(s: DomineeringState): number {
  let hash = (0x811c9dc5 ^ s.turn) >>> 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    hash ^= (s.board[i] === null ? 3 : s.board[i]! + 1) + i * 17;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

function encodeBoard(board: (Player | null)[]): string {
  return board.map((cell) => (cell === null ? '.' : cell === 0 ? 'V' : 'H')).join('');
}

function decodeBoard(encoded: unknown): (Player | null)[] {
  if (typeof encoded !== 'string' || encoded.length !== CELL_COUNT || /[^.VH]/.test(encoded)) {
    throw new Error('Invalid Domineering board');
  }
  return Array.from(encoded, (cell) => (cell === '.' ? null : cell === 'V' ? 0 : 1));
}

const def: GameDefinition<DomineeringState, DomineeringMove> = {
  id: 'domineering',
  name: 'Domineering',
  tagline: 'Claim space in your direction — keep one last domino lane open.',
  blurb:
    'A celebrated orientation game of pure spatial strategy. Vertical can place only upright dominoes; Horizontal can place only sideways dominoes. Every placement permanently covers two cells, reshaping both players’ future options at once. There are no captures and no chance: preserve flexible lanes for yourself, cut across your rival’s lanes, and be the last player able to fit a domino.',
  category: 'Abstract',
  depth: 4,
  emoji: '▥',
  accent: '#14b8a6',
  players: [
    { id: 0, name: 'Vertical', short: 'V', color: '#14b8a6' },
    { id: 1, name: 'Horizontal', short: 'H', color: '#f59e0b' },
  ],
  interaction: { type: 'place' },
  render: {
    pieceStyle: 'mark',
    showCoordinates: true,
    checkered: true,
    cellGap: 0.04,
  },
  evalScale: 150,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    return {
      rows: SIZE,
      cols: SIZE,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
      rankLabels: ['6', '5', '4', '3', '2', '1'],
      cells: s.board.map((player, cell) => ({
        index: cell,
        row: rowOf(cell),
        col: colOf(cell),
        piece: player === null
          ? null
          : {
            id: `dom-${cell}-${player}`,
            kind: player === 0 ? 'vertical-domino' : 'horizontal-domino',
            player,
            glyph: player === 0 ? '│' : '─',
          },
      })),
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (legalMoves(s).length === 0) {
      return {
        kind: 'win',
        winner: (s.turn ^ 1) as Player,
        reason: `${def.players[s.turn].name} has no legal domino placement`,
      };
    }
    return { kind: 'playing' };
  },

  getLegalMoves: (s) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    return searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RANDOMNESS[difficulty],
      rng: mulberry32(positionSeed(s)),
    }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opponent = (mover ^ 1) as Player;
    const search = searchBestMove(before, searchAdapter(), DEPTH.tutor);
    const playedScore =
      search.ranked.find((candidate) => candidate.move.id === move.id)?.score
      ?? evaluate(after);
    const bestScore = search.ranked[0]?.score ?? playedScore;
    const toMover = (score: number) => (mover === 0 ? score : -score);
    const loss = Math.max(0, toMover(bestScore) - toMover(playedScore));

    const beforeMine = mobilityProfile(before.board, mover);
    const beforeTheirs = mobilityProfile(before.board, opponent);
    const afterMine = mobilityProfile(after.board, mover);
    const afterTheirs = mobilityProfile(after.board, opponent);
    const won = generateMoves(after.board, opponent).length === 0;
    const denied = Math.max(0, beforeTheirs.moves - afterTheirs.moves);
    const retained = afterMine.moves;

    const insights: MoveExplanation['insights'] = [
      {
        tag: mover === 0 ? 'Vertical lane' : 'Horizontal lane',
        detail: `${move.notation} covers ${square(move.affected[0])} and ${square(move.affected[1])}.`,
        tone: 'info',
      },
    ];

    if (won) {
      insights.push({
        tag: 'Last placement',
        detail: `${def.players[opponent].name} has no legal domino left, so this move wins.`,
        tone: 'good',
      });
    } else if (denied >= 3) {
      insights.push({
        tag: 'Cuts options',
        detail: `This placement removes ${denied} of the opponent’s possible anchors.`,
        tone: 'good',
      });
    }

    if (!won && retained > afterTheirs.moves) {
      insights.push({
        tag: 'Mobility edge',
        detail: `You retain ${retained} placements against ${afterTheirs.moves} for the opponent.`,
        tone: 'good',
      });
    } else if (!won && afterMine.flexibleCells < afterTheirs.flexibleCells) {
      insights.push({
        tag: 'Narrow lanes',
        detail: 'The opponent retains more cells with multiple placement options.',
        tone: 'bad',
      });
    }

    const principles = [
      'A strong domino does two jobs: it preserves your orientation and crosses through the opponent’s future lanes.',
      beforeMine.moves <= beforeTheirs.moves
        ? 'When behind in mobility, prioritize flexible cells that support more than one future placement.'
        : 'Convert a mobility lead by separating the remaining empty cells into lanes that favor your orientation.',
    ];

    const winningBig = won || Math.abs(toMover(playedScore)) >= 120;
    const band = won ? 'best' : gradeByLoss(loss, winningBig);
    const better =
      loss > 24 && search.move && search.move.id !== move.id
        ? `The stronger placement was ${search.move.notation}; it preserves more usable lanes.`
        : undefined;

    return {
      summary: won
        ? `${def.players[mover].name} makes the last legal placement and wins.`
        : `${def.players[mover].name} places ${move.notation}.`,
      band,
      evalBefore: evaluate(before),
      evalAfter: evaluate(after),
      insights,
      principles,
      threats: !won && afterTheirs.moves <= 2
        ? [`${def.players[opponent].name} has only ${afterTheirs.moves} placement${afterTheirs.moves === 1 ? '' : 's'} left.`]
        : undefined,
      betterIdea: better,
    };
  },

  hint(s) {
    const result = searchBestMove(s, searchAdapter(), DEPTH.master);
    if (!result.move) return null;
    const after = apply(s, result.move);
    const opponent = (s.turn ^ 1) as Player;
    const theirMoves = generateMoves(after.board, opponent).length;
    const ourMoves = generateMoves(after.board, s.turn).length;
    return {
      move: result.move,
      text: theirMoves === 0
        ? `${result.move.notation} is the last placement: the opponent has no legal domino.`
        : `${result.move.notation} leaves ${ourMoves} future ${ourMoves === 1 ? 'option' : 'options'} for your orientation while holding the opponent to ${theirMoves}.`,
    };
  },

  serialize(s) {
    return JSON.stringify({
      version: SERIAL_VERSION,
      board: encodeBoard(s.board),
      turn: s.turn,
    });
  },

  deserialize(serialized) {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Domineering state');
    const value = parsed as { version?: unknown; board?: unknown; turn?: unknown };
    if (value.version !== SERIAL_VERSION || (value.turn !== 0 && value.turn !== 1)) {
      throw new Error('Unsupported Domineering state');
    }
    return { board: decodeBoard(value.board), turn: value.turn };
  },

  tutorial: {
    overview:
      'Domineering is a classic partizan strategy game: the two players obey different movement rules on the same board. Vertical may cover only two cells in a column, while Horizontal may cover only two cells in a row. That one asymmetry creates a rich contest over geometry, timing and usable space. Because every turn fills exactly two cells, the position becomes more constrained until one orientation no longer fits.',
    objective:
      'Be the last player able to place a domino. Vertical anchors a domino on its top cell and covers the cell immediately below; Horizontal anchors on its left cell and covers the cell immediately to the right. Covered cells are permanent and cannot overlap. If your turn begins without a legal placement, you lose.',
    chapters: [
      {
        title: 'Place with purpose',
        icon: '▥',
        steps: [
          {
            title: 'Two orientations, one board',
            body: '**Vertical** always covers two neighboring cells north–south. **Horizontal** always covers two neighboring cells west–east. The players alternate, but neither may copy the other orientation.',
          },
          {
            title: 'Click the anchor',
            body: 'To place a domino, click its **anchor**: the upper cell for Vertical or the left cell for Horizontal. The interface previews the complete two-cell footprint before committing the move.',
            setup: '{"version":1,"board":"....................................","turn":0}',
            highlight: [14, 20],
            arrows: [{ from: 14, to: 20, tone: 'good' }],
          },
          {
            title: 'Covered means closed',
            body: 'A domino may use only two empty cells. Once either player covers a cell, that cell can never be reused. There is no moving, capturing, passing or randomness.',
          },
          {
            title: 'The last lane wins',
            body: 'When your turn starts and no domino fits your orientation, the game ends immediately and the previous player wins. Empty cells can remain; what matters is whether two of them are adjacent in **your** direction.',
          },
        ],
      },
      {
        title: 'Read the geometry',
        icon: '🧭',
        steps: [
          {
            title: 'Mobility is your real score',
            body: 'Count the dominoes each side could place, not simply the number of empty cells. A scattered board may contain plenty of space yet offer no two-cell lane for one orientation.',
          },
          {
            title: 'Cross their lanes',
            body: 'Your domino often intersects several possible enemy anchors. A Vertical placement through a long open row can erase multiple Horizontal options; Horizontal can do the same across columns.',
          },
          {
            title: 'Preserve flexible cells',
            body: 'A cell that belongs to two possible placements gives you a choice next turn. Protect these flexible junctions and avoid turning your remaining space into isolated single cells.',
          },
          {
            title: 'Separate favorable regions',
            body: 'Late in the game, empty space breaks into independent pockets. Try to shape pockets into tall corridors as Vertical or wide corridors as Horizontal, then count which player will make the final placement.',
          },
        ],
      },
      {
        title: 'Lane laboratory',
        icon: '🎯',
        steps: [
          {
            title: 'Close every horizontal route',
            body: 'Vertical has two legal anchors in the central pocket. Only one covers the crossing cells that support **every** remaining Horizontal placement.',
            setup: '{"version":1,"board":".VVHH.VVVHHVV...VVHH..VVVHHHHVVHHHH.","turn":0}',
            highlight: [13, 14, 15, 20, 21],
            challenge: {
              prompt: 'Vertical to move — make the last placement and leave Horizontal with no legal domino.',
              solution: ['Vc4-c3'],
              success: 'Exactly. c4–c3 cuts both horizontal routes at once, so Horizontal has no placement and Vertical wins.',
            },
          },
          {
            title: 'Use the tutor as a mobility lens',
            body: 'During a full match, the tutor compares legal anchors, flexible cells and the opponent’s surviving routes. Use its explanation to learn *why* a lane works, then test the same principle at a higher difficulty.',
          },
        ],
      },
    ],
  },
};

export default def;
