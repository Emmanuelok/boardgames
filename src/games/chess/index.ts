import type { BoardView, GameDefinition, GameStatus, Player } from '../../engine/types';
import {
  Position, initialState, fromFen, applyChessMove, legalMovesFor,
  type ChessState, type ChessMove, typeOf, colorOf, PIECE_LETTER,
  PAWN, KNIGHT, BISHOP, KING,
} from './engine';
import { evaluatePosition } from './evaluate';
import { bestMove, searchBest, MATE } from './search';
import { explainChessMove, chessHint } from './tutor';
import { identifyOpening } from './openings';
import tutorial from './tutorial';

const SOLID: Record<number, string> = { [PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝', 4: '♜', 5: '♛', [KING]: '♚' };

function insufficientMaterial(s: ChessState): boolean {
  let minors = 0;
  for (const p of s.board) {
    const t = typeOf(p);
    if (t === 0 || t === KING) continue;
    if (t === KNIGHT || t === BISHOP) minors++;
    else return false; // a pawn, rook or queen exists
  }
  return minors <= 1; // K vs K, or K+single minor vs K
}

const def: GameDefinition<ChessState, ChessMove> = {
  id: 'chess',
  name: 'Chess',
  tagline: 'The immortal game of strategy — two minds, one board, infinite depth.',
  blurb:
    'The most celebrated board game ever devised. Command an army of pawns and pieces, outmanoeuvre your opponent, and hunt down the enemy king. Our engine plays from gentle to genuinely strong, and the move-by-move tutor explains the why behind every plan, tactic and blunder.',
  category: 'Strategy',
  depth: 5,
  emoji: '♛',
  accent: '#eab308',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#f8fafc' },
    { id: 1, name: 'Black', short: 'B', color: '#0f172a' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'chess', showCoordinates: true, checkered: true },
  evalScale: 400,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, castling: s.castling, ep: s.ep, half: s.half, full: s.full }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: i >> 3, col: i & 7,
      piece: p === 0 ? null : {
        id: `${PIECE_LETTER[Math.abs(p)]}${colorOf(p)}@${i}`,
        kind: PIECE_LETTER[Math.abs(p)].toUpperCase(),
        player: colorOf(p) as Player,
        glyph: SOLID[typeOf(p)],
      },
    }));
    return {
      rows: 8, cols: 8, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn as Player,

  getStatus(s): GameStatus {
    const moves = legalMovesFor(s);
    const pos = new Position(s);
    const inCheck = pos.inCheck(s.turn);
    if (moves.length === 0) {
      if (inCheck) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'checkmate' };
      return { kind: 'draw', reason: 'stalemate — no legal moves' };
    }
    if (s.half >= 100) return { kind: 'draw', reason: 'the fifty-move rule' };
    if (insufficientMaterial(s)) return { kind: 'draw', reason: 'insufficient material' };
    if (inCheck) return { kind: 'check', player: s.turn as Player };
    return { kind: 'playing' };
  },

  getLegalMoves(s, from) {
    const moves = legalMovesFor(s);
    return from == null ? moves : moves.filter((m) => m.from === from);
  },

  applyMove: (s, m) => applyChessMove(s, m),

  chooseMove: (s, difficulty) => bestMove(s, difficulty),

  evaluate: (s) => evaluatePosition(new Position(s)),

  liveEval(s) {
    // A quick principal-variation search so the bar is tactically aware, not just
    // material counting. Score comes back side-to-move-relative; flip to White's.
    const out = searchBest(s, 12, 280);
    const white = s.turn === 0 ? out.score : -out.score;
    let mate: number | undefined;
    if (Math.abs(white) > MATE - 1000) {
      mate = Math.sign(white) * Math.ceil((MATE - Math.abs(white)) / 2);
    }
    return { score: white, depth: out.depth, mate };
  },

  explainMove: (before, move, after) => explainChessMove(before, move, after),

  hint: (s) => chessHint(s),

  identifyOpening: (san) => identifyOpening(san),

  serialize: (s) => new Position(s).fen(),
  deserialize: (str) => fromFen(str),

  tutorial,
};

export default def;
