/**
 * A complete, correct chess engine: board representation, fully legal move
 * generation (castling, en passant, promotion, check/checkmate/stalemate),
 * SAN notation and FEN. Built for both play and teaching — every move carries
 * enough information for the tutor to explain it.
 *
 * Board layout: index 0 = a8 (top-left), 7 = h8, 56 = a1, 63 = h1.
 * Row 0 is the top (Black's back rank); row 7 is the bottom (White's).
 * Piece codes: empty 0; White P1 N2 B3 R4 Q5 K6; Black are the negatives.
 */

export type Color = 0 | 1; // 0 = White, 1 = Black

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

export const WHITE: Color = 0;
export const BLACK: Color = 1;

export const PIECE_LETTER: Record<number, string> = {
  1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K',
  [-1]: 'p', [-2]: 'n', [-3]: 'b', [-4]: 'r', [-5]: 'q', [-6]: 'k',
};
export const GLYPH: Record<number, string> = {
  1: '♙', 2: '♘', 3: '♗', 4: '♖', 5: '♕', 6: '♔',
  [-1]: '♟', [-2]: '♞', [-3]: '♝', [-4]: '♜', [-5]: '♛', [-6]: '♚',
};
export const PIECE_NAME: Record<number, string> = {
  1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king',
};

// Castling-rights bit flags.
export const WK = 1, WQ = 2, BK = 4, BQ = 8;

export interface ChessState {
  board: number[]; // length 64
  turn: Color;
  castling: number; // bitmask of WK|WQ|BK|BQ
  ep: number; // en-passant target square, or -1
  half: number; // halfmove clock (for 50-move rule)
  full: number; // fullmove number
}

export interface ChessMove {
  id: string;
  from: number;
  to: number;
  piece: number; // moving piece code (signed)
  captured: number; // captured piece code (signed), 0 if none
  promo?: number; // promoted-to piece TYPE (2..5), if any (numeric; MoveBase.promotion stays a string)
  isEP?: boolean;
  castle?: 'K' | 'Q';
  double?: boolean; // pawn double-step
  notation: string; // SAN
  capture?: boolean;
  affected?: number[];
}

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3; // 0 = top row (rank 8)
export const colorOf = (p: number): Color => (p > 0 ? WHITE : BLACK);
export const typeOf = (p: number) => Math.abs(p);

/** Algebraic name of a square, e.g. 0 -> "a8", 60 -> "e1". */
export function algebraic(sq: number): string {
  const file = 'abcdefgh'[fileOf(sq)];
  const rank = 8 - rankOf(sq);
  return `${file}${rank}`;
}
export function parseSquare(s: string): number {
  const file = s.charCodeAt(0) - 97;
  const rank = 8 - parseInt(s[1], 10);
  return rank * 8 + file;
}

/* ----------------------- Precomputed move tables ---------------------- */

const KNIGHT_TARGETS: number[][] = [];
const KING_TARGETS: number[][] = [];
// 8 ray directions as [df, dr]
const DIRS = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
} as const;
const ROOK_DIRS = [DIRS.N, DIRS.S, DIRS.E, DIRS.W];
const BISHOP_DIRS = [DIRS.NE, DIRS.NW, DIRS.SE, DIRS.SW];
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];
const RAYS: Record<string, number[][]> = {}; // keyed "df,dr" -> per square array

(function buildTables() {
  const kd = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const kingD = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let sq = 0; sq < 64; sq++) {
    const f = fileOf(sq), r = rankOf(sq);
    KNIGHT_TARGETS[sq] = [];
    for (const [df, dr] of kd) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KNIGHT_TARGETS[sq].push(nr * 8 + nf);
    }
    KING_TARGETS[sq] = [];
    for (const [df, dr] of kingD) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KING_TARGETS[sq].push(nr * 8 + nf);
    }
  }
  for (const [df, dr] of QUEEN_DIRS) {
    const key = `${df},${dr}`;
    RAYS[key] = [];
    for (let sq = 0; sq < 64; sq++) {
      const ray: number[] = [];
      let f = fileOf(sq) + df, r = rankOf(sq) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        ray.push(r * 8 + f);
        f += df; r += dr;
      }
      RAYS[key][sq] = ray;
    }
  }
})();

/* ------------------------------ Position ------------------------------ */

interface Undo {
  move: ChessMove;
  castling: number;
  ep: number;
  half: number;
  full: number;
  captureSq: number; // where the captured piece actually was (differs for EP)
  capturedPiece: number;
}

/** Mutable position used for generation and search (make/unmake). */
export class Position {
  board: Int8Array;
  turn: Color;
  castling: number;
  ep: number;
  half: number;
  full: number;
  private history: Undo[] = [];

  constructor(state: ChessState) {
    this.board = Int8Array.from(state.board);
    this.turn = state.turn;
    this.castling = state.castling;
    this.ep = state.ep;
    this.half = state.half;
    this.full = state.full;
  }

  toState(): ChessState {
    return {
      board: Array.from(this.board),
      turn: this.turn,
      castling: this.castling,
      ep: this.ep,
      half: this.half,
      full: this.full,
    };
  }

  kingSquare(color: Color): number {
    const k = color === WHITE ? KING : -KING;
    for (let i = 0; i < 64; i++) if (this.board[i] === k) return i;
    return -1;
  }

  /** Is `sq` attacked by side `by`? */
  isAttacked(sq: number, by: Color): boolean {
    const b = this.board;
    const sign = by === WHITE ? 1 : -1;
    // Pawns: a white pawn on x attacks the two squares "above" it (towards row 0).
    const pr = by === WHITE ? 1 : -1; // attacker pawns are one rank toward their start
    const f = fileOf(sq), r = rankOf(sq);
    for (const df of [-1, 1]) {
      const af = f + df, ar = r + pr;
      if (af >= 0 && af < 8 && ar >= 0 && ar < 8) {
        if (b[ar * 8 + af] === sign * PAWN) return true;
      }
    }
    // Knights
    for (const t of KNIGHT_TARGETS[sq]) if (b[t] === sign * KNIGHT) return true;
    // King
    for (const t of KING_TARGETS[sq]) if (b[t] === sign * KING) return true;
    // Sliding: rook/queen orthogonally, bishop/queen diagonally
    for (const [df, dr] of ROOK_DIRS) {
      for (const t of RAYS[`${df},${dr}`][sq]) {
        const p = b[t];
        if (p === 0) continue;
        if (p === sign * ROOK || p === sign * QUEEN) return true;
        break;
      }
    }
    for (const [df, dr] of BISHOP_DIRS) {
      for (const t of RAYS[`${df},${dr}`][sq]) {
        const p = b[t];
        if (p === 0) continue;
        if (p === sign * BISHOP || p === sign * QUEEN) return true;
        break;
      }
    }
    return false;
  }

  inCheck(color: Color): boolean {
    return this.isAttacked(this.kingSquare(color), (color ^ 1) as Color);
  }

  /** From-squares of every `by` piece directly attacking `sq` (first blocker per ray). */
  attackersOf(sq: number, by: Color): number[] {
    const b = this.board;
    const sign = by === WHITE ? 1 : -1;
    const out: number[] = [];
    const f = fileOf(sq), r = rankOf(sq);
    const pr = by === WHITE ? 1 : -1;
    for (const df of [-1, 1]) {
      const af = f + df, ar = r + pr;
      if (af >= 0 && af < 8 && ar >= 0 && ar < 8 && b[ar * 8 + af] === sign * PAWN) out.push(ar * 8 + af);
    }
    for (const t of KNIGHT_TARGETS[sq]) if (b[t] === sign * KNIGHT) out.push(t);
    for (const t of KING_TARGETS[sq]) if (b[t] === sign * KING) out.push(t);
    for (const [df, dr] of ROOK_DIRS) {
      for (const t of RAYS[`${df},${dr}`][sq]) {
        const p = b[t];
        if (p === 0) continue;
        if (p === sign * ROOK || p === sign * QUEEN) out.push(t);
        break;
      }
    }
    for (const [df, dr] of BISHOP_DIRS) {
      for (const t of RAYS[`${df},${dr}`][sq]) {
        const p = b[t];
        if (p === 0) continue;
        if (p === sign * BISHOP || p === sign * QUEEN) out.push(t);
        break;
      }
    }
    return out;
  }

  /** Squares the piece on `from` currently attacks (ignores self-check legality). */
  attacksFrom(from: number): number[] {
    const b = this.board;
    const p = b[from];
    if (p === 0) return [];
    const t = typeOf(p);
    const us = colorOf(p);
    const out: number[] = [];
    if (t === PAWN) {
      const pr = us === WHITE ? -1 : 1;
      const f = fileOf(from), r = rankOf(from);
      for (const df of [-1, 1]) {
        const af = f + df, ar = r + pr;
        if (af >= 0 && af < 8 && ar >= 0 && ar < 8) out.push(ar * 8 + af);
      }
    } else if (t === KNIGHT) {
      out.push(...KNIGHT_TARGETS[from]);
    } else if (t === KING) {
      out.push(...KING_TARGETS[from]);
    } else {
      const dirs = t === ROOK ? ROOK_DIRS : t === BISHOP ? BISHOP_DIRS : QUEEN_DIRS;
      for (const [df, dr] of dirs) {
        for (const to of RAYS[`${df},${dr}`][from]) {
          out.push(to);
          if (b[to] !== 0) break;
        }
      }
    }
    return out;
  }

  /** Pseudo-legal moves (may leave own king in check). */
  private genPseudo(): ChessMove[] {
    const b = this.board;
    const us = this.turn;
    const sign = us === WHITE ? 1 : -1;
    const moves: ChessMove[] = [];
    const homeRank = us === WHITE ? 6 : 1; // pawn start row
    const promoRank = us === WHITE ? 0 : 7;
    const forward = us === WHITE ? -8 : 8;

    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (p === 0 || colorOf(p) !== us) continue;
      const t = typeOf(p);

      if (t === PAWN) {
        const one = from + forward;
        if (one >= 0 && one < 64 && b[one] === 0) {
          if (rankOf(one) === promoRank) this.addPromotions(moves, from, one, p, 0);
          else moves.push(this.mk(from, one, p, 0, { double: false }));
          // double from home rank
          if (rankOf(from) === homeRank) {
            const two = from + forward * 2;
            if (b[two] === 0) moves.push(this.mk(from, two, p, 0, { double: true }));
          }
        }
        // captures
        for (const df of [-1, 1]) {
          const cf = fileOf(from) + df;
          if (cf < 0 || cf > 7) continue;
          const cap = from + forward + df;
          if (cap < 0 || cap > 63) continue;
          const target = b[cap];
          if (target !== 0 && colorOf(target) !== us) {
            if (rankOf(cap) === promoRank) this.addPromotions(moves, from, cap, p, target);
            else moves.push(this.mk(from, cap, p, target, {}));
          } else if (cap === this.ep && this.ep !== -1) {
            // en passant: captured pawn sits beside the from square
            const capturedSq = cap - forward;
            moves.push(this.mk(from, cap, p, b[capturedSq], { isEP: true }));
          }
        }
      } else if (t === KNIGHT) {
        for (const to of KNIGHT_TARGETS[from]) {
          const tp = b[to];
          if (tp === 0 || colorOf(tp) !== us) moves.push(this.mk(from, to, p, tp, {}));
        }
      } else if (t === KING) {
        for (const to of KING_TARGETS[from]) {
          const tp = b[to];
          if (tp === 0 || colorOf(tp) !== us) moves.push(this.mk(from, to, p, tp, {}));
        }
        // castling
        this.addCastles(moves, from, p, us, sign);
      } else {
        const dirs = t === ROOK ? ROOK_DIRS : t === BISHOP ? BISHOP_DIRS : QUEEN_DIRS;
        for (const [df, dr] of dirs) {
          for (const to of RAYS[`${df},${dr}`][from]) {
            const tp = b[to];
            if (tp === 0) { moves.push(this.mk(from, to, p, 0, {})); continue; }
            if (colorOf(tp) !== us) moves.push(this.mk(from, to, p, tp, {}));
            break;
          }
        }
      }
    }
    return moves;
  }

  private addCastles(moves: ChessMove[], from: number, p: number, us: Color, sign: number) {
    const opp = (us ^ 1) as Color;
    if (this.inCheck(us)) return;
    if (us === WHITE) {
      if ((this.castling & WK) && this.board[61] === 0 && this.board[62] === 0 &&
        !this.isAttacked(61, opp) && !this.isAttacked(62, opp)) {
        moves.push(this.mk(from, 62, p, 0, { castle: 'K' }));
      }
      if ((this.castling & WQ) && this.board[59] === 0 && this.board[58] === 0 && this.board[57] === 0 &&
        !this.isAttacked(59, opp) && !this.isAttacked(58, opp)) {
        moves.push(this.mk(from, 58, p, 0, { castle: 'Q' }));
      }
    } else {
      if ((this.castling & BK) && this.board[5] === 0 && this.board[6] === 0 &&
        !this.isAttacked(5, opp) && !this.isAttacked(6, opp)) {
        moves.push(this.mk(from, 6, p, 0, { castle: 'K' }));
      }
      if ((this.castling & BQ) && this.board[3] === 0 && this.board[2] === 0 && this.board[1] === 0 &&
        !this.isAttacked(3, opp) && !this.isAttacked(2, opp)) {
        moves.push(this.mk(from, 2, p, 0, { castle: 'Q' }));
      }
    }
    void sign;
  }

  private addPromotions(moves: ChessMove[], from: number, to: number, p: number, captured: number) {
    for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      moves.push(this.mk(from, to, p, captured, { promo }));
    }
  }

  private mk(from: number, to: number, piece: number, captured: number, extra: Partial<ChessMove>): ChessMove {
    const m: ChessMove = {
      id: `${from}-${to}${extra.promo ? PIECE_LETTER[extra.promo] : ''}`,
      from, to, piece, captured,
      notation: '', // filled by SAN when needed
      capture: captured !== 0 || !!extra.isEP,
      ...extra,
    };
    return m;
  }

  /** Fully legal moves. */
  legalMoves(): ChessMove[] {
    const pseudo = this.genPseudo();
    const us = this.turn;
    const legal: ChessMove[] = [];
    for (const m of pseudo) {
      this.make(m);
      if (!this.inCheck(us)) legal.push(m);
      this.unmake();
    }
    return legal;
  }

  make(m: ChessMove) {
    const b = this.board;
    const us = this.turn;
    const undo: Undo = {
      move: m, castling: this.castling, ep: this.ep, half: this.half, full: this.full,
      captureSq: -1, capturedPiece: 0,
    };

    // Handle capture (including en passant)
    let captureSq = m.to;
    if (m.isEP) captureSq = m.to - (us === WHITE ? -8 : 8);
    if (b[captureSq] !== 0 && captureSq !== m.from) {
      undo.captureSq = captureSq;
      undo.capturedPiece = b[captureSq];
      b[captureSq] = 0;
    }

    // Move the piece
    b[m.to] = m.promo ? (us === WHITE ? m.promo : -m.promo) : m.piece;
    b[m.from] = 0;

    // Rook hop for castling
    if (m.castle === 'K') {
      if (us === WHITE) { b[61] = b[63]; b[63] = 0; } else { b[5] = b[7]; b[7] = 0; }
    } else if (m.castle === 'Q') {
      if (us === WHITE) { b[59] = b[56]; b[56] = 0; } else { b[3] = b[0]; b[0] = 0; }
    }

    // Update castling rights
    if (m.piece === KING) this.castling &= ~(WK | WQ);
    if (m.piece === -KING) this.castling &= ~(BK | BQ);
    const touch = (sq: number) => {
      if (sq === 63) this.castling &= ~WK;
      if (sq === 56) this.castling &= ~WQ;
      if (sq === 7) this.castling &= ~BK;
      if (sq === 0) this.castling &= ~BQ;
    };
    touch(m.from); touch(m.to);

    // En-passant target
    this.ep = m.double ? (m.from + m.to) / 2 : -1;

    // Clocks
    if (typeOf(m.piece) === PAWN || m.capture) this.half = 0; else this.half++;
    if (us === BLACK) this.full++;
    this.turn = (us ^ 1) as Color;
    this.history.push(undo);
  }

  unmake() {
    const undo = this.history.pop();
    if (!undo) return;
    const m = undo.move;
    const b = this.board;
    this.turn = (this.turn ^ 1) as Color;
    const us = this.turn;

    // Move piece back
    b[m.from] = m.piece;
    b[m.to] = 0;

    // Restore captured piece
    if (undo.captureSq !== -1) b[undo.captureSq] = undo.capturedPiece;

    // Undo rook hop
    if (m.castle === 'K') {
      if (us === WHITE) { b[63] = b[61]; b[61] = 0; } else { b[7] = b[5]; b[5] = 0; }
    } else if (m.castle === 'Q') {
      if (us === WHITE) { b[56] = b[59]; b[59] = 0; } else { b[0] = b[3]; b[3] = 0; }
    }

    this.castling = undo.castling;
    this.ep = undo.ep;
    this.half = undo.half;
    this.full = undo.full;
  }

  /** Standard Algebraic Notation for a legal move in this position. */
  toSAN(m: ChessMove): string {
    if (m.castle === 'K') return this.checkSuffix(m, 'O-O');
    if (m.castle === 'Q') return this.checkSuffix(m, 'O-O-O');
    const t = typeOf(m.piece);
    const dest = algebraic(m.to);
    let san = '';
    if (t === PAWN) {
      if (m.capture) san += 'abcdefgh'[fileOf(m.from)] + 'x';
      san += dest;
      if (m.promo) san += '=' + PIECE_LETTER[m.promo];
    } else {
      san += PIECE_LETTER[t];
      san += this.disambiguate(m);
      if (m.capture) san += 'x';
      san += dest;
    }
    return this.checkSuffix(m, san);
  }

  private disambiguate(m: ChessMove): string {
    const t = typeOf(m.piece);
    const others = this.legalMoves().filter(
      (o) => o.to === m.to && typeOf(o.piece) === t && o.from !== m.from && colorOf(o.piece) === colorOf(m.piece),
    );
    if (others.length === 0) return '';
    const sameFile = others.some((o) => fileOf(o.from) === fileOf(m.from));
    const sameRank = others.some((o) => rankOf(o.from) === rankOf(m.from));
    if (!sameFile) return 'abcdefgh'[fileOf(m.from)];
    if (!sameRank) return String(8 - rankOf(m.from));
    return algebraic(m.from);
  }

  private checkSuffix(m: ChessMove, san: string): string {
    this.make(m);
    const opp = this.turn;
    let suffix = '';
    if (this.inCheck(opp)) suffix = this.legalMoves().length === 0 ? '#' : '+';
    this.unmake();
    return san + suffix;
  }

  fen(): string {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (p === 0) empty++;
        else {
          if (empty) { fen += empty; empty = 0; }
          fen += PIECE_LETTER[p];
        }
      }
      if (empty) fen += empty;
      if (r < 7) fen += '/';
    }
    fen += ` ${this.turn === WHITE ? 'w' : 'b'} `;
    let c = '';
    if (this.castling & WK) c += 'K';
    if (this.castling & WQ) c += 'Q';
    if (this.castling & BK) c += 'k';
    if (this.castling & BQ) c += 'q';
    fen += c || '-';
    fen += ` ${this.ep === -1 ? '-' : algebraic(this.ep)} ${this.half} ${this.full}`;
    return fen;
  }
}

/* --------------------------- Convenience API -------------------------- */

export function initialState(): ChessState {
  return fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
}

export function fromFen(fen: string): ChessState {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(0);
  let sq = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') { sq += parseInt(ch, 10); continue; }
    const code = Object.entries(PIECE_LETTER).find(([, l]) => l === ch);
    if (code) board[sq] = parseInt(code[0], 10);
    sq++;
  }
  let castling = 0;
  if (castle?.includes('K')) castling |= WK;
  if (castle?.includes('Q')) castling |= WQ;
  if (castle?.includes('k')) castling |= BK;
  if (castle?.includes('q')) castling |= BQ;
  return {
    board,
    turn: turn === 'b' ? BLACK : WHITE,
    castling,
    ep: ep && ep !== '-' ? parseSquare(ep) : -1,
    half: half ? parseInt(half, 10) : 0,
    full: full ? parseInt(full, 10) : 1,
  };
}

/** Immutable apply: returns the new state with the move's SAN filled in. */
export function applyChessMove(state: ChessState, move: ChessMove): ChessState {
  const pos = new Position(state);
  if (!move.notation) move.notation = pos.toSAN(move);
  pos.make(move);
  return pos.toState();
}

export function legalMovesFor(state: ChessState): ChessMove[] {
  const pos = new Position(state);
  const moves = pos.legalMoves();
  for (const m of moves) m.notation = pos.toSAN(m);
  return moves;
}
