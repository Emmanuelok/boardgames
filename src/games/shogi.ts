import type {
  BoardView, Difficulty, GameDefinition, GameStatus, HandPiece, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Shogi — Japanese chess on a 9×9 board, with the celebrated DROP rule.      */
/*                                                                            */
/*  Shogi's soul is that captured pieces switch sides: a man you take goes     */
/*  into your "hand", and on a later turn you may parachute it back onto any   */
/*  empty square as one of your own. Nothing is ever truly off the board, so   */
/*  attacks never run out of ammunition and the game seethes with possibility. */
/*                                                                            */
/*  Sente (player 0, black pieces) moves FIRST and marches UP toward row 0;    */
/*  Gote (player 1, red pieces) marches DOWN toward row 8. Eight kinds of      */
/*  piece — King, Rook, Bishop, Gold, Silver, Knight, Lance, Pawn — start on   */
/*  the board; six of them PROMOTE when they reach the farthest three ranks    */
/*  (the "promotion zone"), most of them turning into a Gold. Win by           */
/*  checkmating the enemy King.                                                */
/* -------------------------------------------------------------------------- */

const COLS = 9;
const ROWS = 9;
const N = COLS * ROWS; // 81

/** Base piece kinds. Promoted pieces carry the same `type` plus `promoted`. */
export type PieceType = 'K' | 'R' | 'B' | 'G' | 'S' | 'N' | 'L' | 'P';

export interface Piece {
  type: PieceType;
  player: Player;
  promoted: boolean;
}

export interface ShogiState {
  board: (Piece | null)[]; // 81 cells, row-major, row 0 = top (Gote's edge)
  /** Captured pieces in hand: hands[player][baseKind] = count. */
  hands: [Record<string, number>, Record<string, number>];
  turn: Player;
  /** Half-move counter — used to vary the AI seed so it never loops forever in
   *  a shuffling position. Defaulted on deserialize for backward compatibility. */
  ply: number;
}

export interface ShogiMove extends MoveBase {
  /** Piece kind that moved or was dropped: base letter, or '+'+letter when the
   *  resulting piece on the board is promoted (board moves only). */
  kind: string;
}

const idx = (row: number, col: number) => row * COLS + col;
const rowOf = (i: number) => Math.floor(i / COLS);
const colOf = (i: number) => i % COLS;
const onBoard = (row: number, col: number) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

/** Sente (0) marches up (row decreases); Gote (1) marches down (row increases). */
const forwardOf = (player: Player) => (player === 0 ? -1 : 1);

/** The promotion zone — the farthest three ranks for `player`. Sente: rows 0–2,
 *  Gote: rows 6–8. */
const inPromoZone = (player: Player, row: number) =>
  player === 0 ? row <= 2 : row >= ROWS - 3;

/** The last rank for `player` (a P or L there could never move again). */
const lastRank = (player: Player) => (player === 0 ? 0 : ROWS - 1);

/* ------------------------------- Notation -------------------------------- */
// Shogi files run 9→1 left-to-right and ranks a→i top-to-bottom in the West;
// for clarity we use simple algebraic-ish coordinates: files a–i (col 0→8),
// ranks 1–9 from the TOP (row 0 = rank 1). A board move reads "P 7g–7f", a
// capture "Rx2b", a promotion adds "+", and a drop reads "P*5e".
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
const sq = (i: number) => `${FILES[colOf(i)]}${rowOf(i) + 1}`;
const sideName = (p: Player) => (p === 0 ? 'Sente' : 'Gote');

const PIECE_NAME: Record<PieceType, string> = {
  K: 'King', R: 'Rook', B: 'Bishop', G: 'Gold', S: 'Silver', N: 'Knight', L: 'Lance', P: 'Pawn',
};

const PROMOTED_NAME: Record<PieceType, string> = {
  K: 'King', R: 'Dragon', B: 'Horse', G: 'Gold', S: 'Promoted Silver', N: 'Promoted Knight', L: 'Promoted Lance', P: 'Tokin',
};

/** Kanji glyphs. Base forms first; promoted forms in PROMO_GLYPH. */
const GLYPH: Record<PieceType, string> = {
  K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
};
const PROMO_GLYPH: Record<PieceType, string> = {
  K: '玉', R: '龍', B: '馬', G: '金', S: '全', N: '圭', L: '杏', P: 'と',
};

const glyphFor = (p: Piece) => (p.promoted ? PROMO_GLYPH[p.type] : GLYPH[p.type]);
/** The piece's `kind` string for views/moves: '+R' when promoted else 'R'. */
const kindOf = (p: Piece) => (p.promoted ? `+${p.type}` : p.type);

/** Can this base type ever promote? (Not King or Gold.) */
const PROMOTABLE: Record<PieceType, boolean> = {
  K: false, R: true, B: true, G: false, S: true, N: true, L: true, P: true,
};

/** Order pieces are shown / valued, strongest first (drops sorted by this). */
const DROP_ORDER: PieceType[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

/* --------------------------- State construction -------------------------- */

function emptyHands(): [Record<string, number>, Record<string, number>] {
  return [{}, {}];
}

function createInitialState(): ShogiState {
  const board: (Piece | null)[] = Array(N).fill(null);
  const place = (row: number, col: number, type: PieceType, player: Player) => {
    board[idx(row, col)] = { type, player, promoted: false };
  };

  const backRow: PieceType[] = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];

  // Gote (player 1) along the top.
  for (let col = 0; col < COLS; col++) place(0, col, backRow[col], 1);
  place(1, 1, 'R', 1); // Gote rook on the left of its second rank
  place(1, 7, 'B', 1); // Gote bishop on the right
  for (let col = 0; col < COLS; col++) place(2, col, 'P', 1);

  // Sente (player 0) mirrors along the bottom.
  for (let col = 0; col < COLS; col++) place(6, col, 'P', 0);
  place(7, 1, 'B', 0); // Sente bishop on the left of its second rank
  place(7, 7, 'R', 0); // Sente rook on the right
  for (let col = 0; col < COLS; col++) place(8, col, backRow[col], 0);

  return { board, hands: emptyHands(), turn: 0, ply: 0 };
}

function cloneState(s: ShogiState): ShogiState {
  return {
    board: s.board.map((p) => (p ? { type: p.type, player: p.player, promoted: p.promoted } : null)),
    hands: [{ ...s.hands[0] }, { ...s.hands[1] }],
    turn: s.turn,
    ply: s.ply ?? 0,
  };
}

/* ----------------------------- Move geometry ----------------------------- */
// Step (single-square) and ride (sliding) move generation. "Forward" is encoded
// relative to the moving player. Directions are [dRow, dCol].

const GOLD_STEPS = (player: Player): Array<[number, number]> => {
  const f = forwardOf(player);
  // Orthogonal in all four directions + the two forward diagonals.
  return [
    [f, 0], [-f, 0], [0, -1], [0, 1], // up/down/left/right (forward, back, sides)
    [f, -1], [f, 1], // forward diagonals
  ];
};

const SILVER_STEPS = (player: Player): Array<[number, number]> => {
  const f = forwardOf(player);
  // Straight forward + all four diagonals.
  return [
    [f, 0],
    [f, -1], [f, 1], [-f, -1], [-f, 1],
  ];
};

const KING_STEPS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

const ROOK_DIRS: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * Pseudo-legal destinations for the piece at `from` (bare cell indices),
 * ignoring whether the move leaves the mover's own king in check.
 */
function pseudoTargets(board: (Piece | null)[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const { player, promoted, type } = piece;
  const r = rowOf(from);
  const c = colOf(from);
  const out: number[] = [];

  const friendly = (i: number) => board[i] !== null && board[i]!.player === player;

  const step = (dirs: Array<[number, number]>) => {
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (!onBoard(nr, nc)) continue;
      const to = idx(nr, nc);
      if (!friendly(to)) out.push(to);
    }
  };

  const ride = (dirs: Array<[number, number]>) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (onBoard(nr, nc)) {
        const to = idx(nr, nc);
        const occ = board[to];
        if (occ === null) {
          out.push(to);
        } else {
          if (occ.player !== player) out.push(to); // capture
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  };

  // Promoted gold-likes (+P, +L, +N, +S) all move exactly like Gold.
  if (promoted && (type === 'P' || type === 'L' || type === 'N' || type === 'S')) {
    step(GOLD_STEPS(player));
    return out;
  }

  switch (type) {
    case 'K':
      step(KING_STEPS);
      break;
    case 'G':
      step(GOLD_STEPS(player));
      break;
    case 'S':
      step(SILVER_STEPS(player));
      break;
    case 'N': {
      // Forward-only knight: two squares forward, one to either side.
      const f = forwardOf(player);
      for (const dc of [-1, 1]) {
        const nr = r + 2 * f;
        const nc = c + dc;
        if (!onBoard(nr, nc)) continue;
        const to = idx(nr, nc);
        if (!friendly(to)) out.push(to);
      }
      break;
    }
    case 'L': {
      // Any distance straight forward.
      ride([[forwardOf(player), 0]]);
      break;
    }
    case 'P': {
      const nr = r + forwardOf(player);
      if (onBoard(nr, c) && !friendly(idx(nr, c))) out.push(idx(nr, c));
      break;
    }
    case 'R': {
      ride(ROOK_DIRS);
      if (promoted) step(BISHOP_DIRS); // Dragon: rook + one step diagonally
      break;
    }
    case 'B': {
      ride(BISHOP_DIRS);
      if (promoted) step(ROOK_DIRS); // Horse: bishop + one step orthogonally
      break;
    }
  }
  return out;
}

/* --------------------------- Check / legality ---------------------------- */

function kingCell(board: (Piece | null)[], player: Player): number {
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p && p.type === 'K' && p.player === player) return i;
  }
  return -1;
}

/** Is `player`'s king attacked on this board? */
function inCheckBoard(board: (Piece | null)[], player: Player): boolean {
  const kc = kingCell(board, player);
  if (kc < 0) return true; // king gone — treat as check (lost)
  const enemy = (player ^ 1) as Player;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.player !== enemy) continue;
    const targets = pseudoTargets(board, i);
    for (const t of targets) if (t === kc) return true;
  }
  return false;
}

function inCheck(s: ShogiState, player: Player): boolean {
  return inCheckBoard(s.board, player);
}

/* ----------------------------- Move generation --------------------------- */

/**
 * Whether a board move from→to must promote (the unpromoted piece could never
 * move again): a Pawn or Lance reaching the last rank, or a Knight reaching the
 * last two ranks.
 */
function mustPromote(type: PieceType, player: Player, toRow: number): boolean {
  if (type === 'P' || type === 'L') return toRow === lastRank(player);
  if (type === 'N') {
    const last = lastRank(player);
    const before = last - forwardOf(player); // the rank one step before the last
    return toRow === last || toRow === before;
  }
  return false;
}

/**
 * Build the single board move for (from→to). Auto-promotion: a promotable piece
 * promotes when the move starts or ends in the promotion zone; where leaving it
 * unpromoted would be illegal it must promote. We emit exactly ONE move.
 */
function buildBoardMove(board: (Piece | null)[], from: number, to: number): ShogiMove {
  const piece = board[from]!;
  const captured = board[to];
  const fromRow = rowOf(from);
  const toRow = rowOf(to);

  let promote = false;
  if (!piece.promoted && PROMOTABLE[piece.type]) {
    const touchesZone = inPromoZone(piece.player, fromRow) || inPromoZone(piece.player, toRow);
    if (touchesZone) promote = true;
    if (mustPromote(piece.type, piece.player, toRow)) promote = true;
  }

  const resultPromoted = piece.promoted || promote;
  const kind = resultPromoted ? `+${piece.type}` : piece.type;
  // Notation: base letter, source square, '–' (move) or '×' (capture), target,
  // and a trailing '+' when the move promotes. E.g. "P 7g–7f", "R 8h×2b+".
  const letter = piece.promoted ? `+${piece.type}` : piece.type;
  const cap = captured !== null;
  const notation = `${letter} ${sq(from)}${cap ? '×' : '–'}${sq(to)}${promote ? '+' : ''}`;

  return {
    id: `${from}-${to}`,
    from,
    to,
    notation,
    capture: cap,
    promotion: promote ? `+${piece.type}` : undefined,
    kind,
  };
}

/** Apply a board move on a board copy, handling promotion + capture-to-hand is
 *  done in applyMove; this only relocates and (optionally) promotes for the
 *  legality probe. Captured piece is simply removed. */
function probeBoard(board: (Piece | null)[], m: ShogiMove): (Piece | null)[] {
  const next = board.slice();
  const piece = next[m.from!]!;
  next[m.from!] = null;
  next[m.to] = {
    type: piece.type,
    player: piece.player,
    promoted: piece.promoted || m.promotion !== undefined,
  };
  return next;
}

/** Apply a drop on a board copy (for legality probing). */
function probeDrop(board: (Piece | null)[], m: ShogiMove, player: Player): (Piece | null)[] {
  const next = board.slice();
  next[m.to] = { type: m.drop as PieceType, player, promoted: false };
  return next;
}

/** Does `player` already have an unpromoted pawn on file `col`? (nifu check.) */
function hasUnpromotedPawnOnFile(board: (Piece | null)[], player: Player, col: number): boolean {
  for (let row = 0; row < ROWS; row++) {
    const p = board[idx(row, col)];
    if (p && p.player === player && p.type === 'P' && !p.promoted) return true;
  }
  return false;
}

/** A drop of `kind` on the (row,col) square is geometrically allowed (the piece
 *  must be able to move later, and nifu for pawns). */
function dropLegalSquare(board: (Piece | null)[], kind: PieceType, player: Player, row: number, col: number): boolean {
  if (board[idx(row, col)] !== null) return false; // only onto empty squares
  if (kind === 'P' || kind === 'L') {
    if (row === lastRank(player)) return false;
  }
  if (kind === 'N') {
    const last = lastRank(player);
    const before = last - forwardOf(player);
    if (row === last || row === before) return false;
  }
  if (kind === 'P' && hasUnpromotedPawnOnFile(board, player, col)) return false; // nifu
  return true;
}

function buildDropMove(kind: PieceType, to: number): ShogiMove {
  return {
    id: `d${kind}-${to}`,
    to,
    notation: `${kind}*${sq(to)}`,
    drop: kind,
    kind,
  };
}

/**
 * Legal moves for the side to move. Board moves are filtered so they never
 * leave (or keep) the mover's own king in check; drops are similarly filtered.
 * When `fromCell` is supplied only BOARD moves originating there are returned
 * (the UI uses this to show a selected piece's destinations); drops are returned
 * only when `fromCell` is null/undefined.
 */
function legalMoves(s: ShogiState, fromCell?: number | null): ShogiMove[] {
  const { board, turn } = s;
  const moves: ShogiMove[] = [];

  const restricted = fromCell !== undefined && fromCell !== null;

  // Board moves.
  const sources: number[] = [];
  if (restricted) {
    const p = board[fromCell];
    if (p && p.player === turn) sources.push(fromCell);
  } else {
    for (let i = 0; i < N; i++) {
      const p = board[i];
      if (p && p.player === turn) sources.push(i);
    }
  }

  for (const from of sources) {
    for (const to of pseudoTargets(board, from)) {
      const m = buildBoardMove(board, from, to);
      const next = probeBoard(board, m);
      if (inCheckBoard(next, turn)) continue; // would leave own king in check
      moves.push(m);
    }
  }

  // Drops — only when not restricted to a board source.
  if (!restricted) {
    const hand = s.hands[turn];
    for (const kind of DROP_ORDER) {
      const count = hand[kind] ?? 0;
      if (count <= 0) continue;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (!dropLegalSquare(board, kind, turn, row, col)) continue;
          const to = idx(row, col);
          const m = buildDropMove(kind, to);
          const next = probeDrop(board, m, turn);
          if (inCheckBoard(next, turn)) continue; // a drop may not leave own king in check
          moves.push(m);
        }
      }
    }
  }

  return moves;
}

/** Fast existence check: does the side to move have ANY legal reply? */
function hasAnyLegalMove(s: ShogiState): boolean {
  const { board, turn } = s;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.player !== turn) continue;
    for (const to of pseudoTargets(board, i)) {
      const m = buildBoardMove(board, i, to);
      const next = probeBoard(board, m);
      if (!inCheckBoard(next, turn)) return true;
    }
  }
  // Drops.
  const hand = s.hands[turn];
  for (const kind of DROP_ORDER) {
    if ((hand[kind] ?? 0) <= 0) continue;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!dropLegalSquare(board, kind as PieceType, turn, row, col)) continue;
        const next = probeDrop(board, buildDropMove(kind as PieceType, idx(row, col)), turn);
        if (!inCheckBoard(next, turn)) return true;
      }
    }
  }
  return false;
}

/* ------------------------------- Apply move ------------------------------ */

function applyMove(s: ShogiState, m: ShogiMove): ShogiState {
  const board = s.board.map((p) => (p ? { type: p.type, player: p.player, promoted: p.promoted } : null));
  const hands: [Record<string, number>, Record<string, number>] = [{ ...s.hands[0] }, { ...s.hands[1] }];
  const turn = s.turn;

  if (m.drop !== undefined) {
    // Drop from hand: place an unpromoted piece, decrement the hand.
    const kind = m.drop;
    hands[turn][kind] = (hands[turn][kind] ?? 0) - 1;
    if (hands[turn][kind] <= 0) delete hands[turn][kind];
    board[m.to] = { type: kind as PieceType, player: turn, promoted: false };
    return { board, hands, turn: (turn ^ 1) as Player, ply: (s.ply ?? 0) + 1 };
  }

  // Board move: capture (demote to base type into the mover's hand), relocate,
  // and promote if the move says so.
  const captured = board[m.to];
  if (captured) {
    const base = captured.type; // capture always demotes to the base kind
    if (base !== 'K') {
      hands[turn][base] = (hands[turn][base] ?? 0) + 1;
    }
  }

  const piece = board[m.from!]!;
  board[m.from!] = null;
  board[m.to] = {
    type: piece.type,
    player: piece.player,
    promoted: piece.promoted || m.promotion !== undefined,
  };

  return { board, hands, turn: (turn ^ 1) as Player, ply: (s.ply ?? 0) + 1 };
}

/* ------------------------------- Evaluation ------------------------------ */

// Material values (centipawn-ish). Promoted pieces gain ~150 over their base
// (capped sensibly for the very strong promoted rook/bishop).
const VALUE: Record<PieceType, number> = {
  P: 100, L: 250, N: 300, S: 450, G: 500, B: 650, R: 800, K: 100000,
};
const PROMO_VALUE: Record<PieceType, number> = {
  P: 600, L: 620, N: 640, S: 640, G: 500, B: 950, R: 1050, K: 100000,
};

const pieceValue = (p: Piece) => (p.promoted ? PROMO_VALUE[p.type] : VALUE[p.type]);
/** Hand pieces are worth (almost) their board value — a drop is powerful. */
const handValue = (kind: string) => Math.round(VALUE[kind as PieceType] * 1.05);

/**
 * Static evaluation from Sente (player 0)'s perspective; positive favours Sente.
 * Material on board AND in hand dominates; on top we add king safety (defenders
 * around the king, penalty for an exposed king deep in the centre) and a small
 * bonus for pieces advanced into / promoted in the enemy camp.
 */
function evaluate(s: ShogiState): number {
  const { board } = s;
  let senteKing = false;
  let goteKing = false;
  let score = 0;

  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p) continue;
    const sign = p.player === 0 ? 1 : -1;
    if (p.type === 'K') {
      if (p.player === 0) senteKing = true;
      else goteKing = true;
      // King safety: count friendly defenders on the eight neighbouring squares.
      const r = rowOf(i);
      const c = colOf(i);
      let guards = 0;
      for (const [dr, dc] of KING_STEPS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!onBoard(nr, nc)) continue;
        const g = board[idx(nr, nc)];
        if (g && g.player === p.player) guards++;
      }
      score += sign * guards * 14;
      // A king that has wandered toward the centre files is in more danger.
      const fileFromEdge = Math.min(c, COLS - 1 - c); // 0 at the rim, 4 centre
      score -= sign * fileFromEdge * 6;
      continue;
    }
    score += sign * pieceValue(p);
    // Advancement / promotion bonus: pieces deep in enemy territory press hard.
    if (p.promoted) score += sign * 12;
    if (inPromoZone(p.player, rowOf(i)) && (p.type === 'P' || p.type === 'L' || p.type === 'N' || p.type === 'S')) {
      score += sign * 6;
    }
  }

  // Pieces in hand — nearly as valuable as on the board, and instantly usable.
  for (const kind of DROP_ORDER) {
    score += (s.hands[0][kind] ?? 0) * handValue(kind);
    score -= (s.hands[1][kind] ?? 0) * handValue(kind);
  }

  if (!senteKing) return -WIN;
  if (!goteKing) return WIN;

  return score;
}

/* --------------------------------- Search -------------------------------- */

function captureValue(board: (Piece | null)[], to: number): number {
  const victim = board[to];
  return victim ? pieceValue(victim) : 0;
}

/** Move ordering: captures (most valuable victim first), then checks, then
 *  promotions, then drops near the enemy king, then quiet moves. */
function orderScore(s: ShogiState, m: ShogiMove): number {
  let v = 0;
  if (m.capture) v += 10000 + captureValue(s.board, m.to);
  if (m.promotion) v += 400;
  if (m.drop) {
    // Drops near the enemy king are interesting; otherwise mild.
    const enemyKing = kingCell(s.board, (s.turn ^ 1) as Player);
    if (enemyKing >= 0) {
      const dist = Math.abs(rowOf(m.to) - rowOf(enemyKing)) + Math.abs(colOf(m.to) - colOf(enemyKing));
      v += Math.max(0, 30 - dist * 4);
    }
    v += VALUE[m.drop as PieceType] / 50;
  }
  return v;
}

function searchAdapter() {
  return {
    getLegalMoves: (s: ShogiState) => legalMoves(s),
    applyMove,
    getTurn: (s: ShogiState) => s.turn,
    // Terminal = the side to move has no legal reply (checkmate or stalemate);
    // either way that side has lost in Shogi.
    isTerminal: (s: ShogiState) => !hasAnyLegalMove(s),
    evaluate,
    order: orderScore,
  };
}

// Shogi's branching factor is enormous once hands fill with droppable pieces, so
// we keep the search shallow and lean on aggressive move ordering for sharpness.
const DEPTH: Record<Difficulty, number> = { tutor: 2, easy: 1, medium: 2, hard: 3, master: 3 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.35, hard: 0.08, master: 0 };

function pieceCount(s: ShogiState): number {
  let n = 0;
  for (const p of s.board) if (p) n++;
  for (const k of DROP_ORDER) n += (s.hands[0][k] ?? 0) + (s.hands[1][k] ?? 0);
  return n;
}

/** A cheap position hash so the RNG diverges across distinct positions, and the
 *  ply count so a shuffling line never reuses the same seed twice — together
 *  these guarantee the AI eventually breaks any repetition and reaches a result. */
function seedFor(s: ShogiState): number {
  let h = (s.turn + 1) * 0x9e3779b1;
  for (let i = 0; i < N; i++) {
    const p = s.board[i];
    if (!p) continue;
    h = Math.imul(h ^ (i + 1), 2654435761);
    h = Math.imul(h ^ ((p.type.charCodeAt(0) << 2) | (p.player << 1) | (p.promoted ? 1 : 0)), 40503);
  }
  h ^= pieceCount(s) * 0x85ebca6b;
  h ^= (s.ply ?? 0) * 0xc2b2ae35;
  return h >>> 0;
}

function chooseMove(s: ShogiState, difficulty: Difficulty): ShogiMove | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
    randomness: RAND[difficulty],
    rng: mulberry32(seedFor(s)),
  });
  return res.move;
}

/* ---------------------------- Status & helpers --------------------------- */

function getStatus(s: ShogiState): GameStatus {
  const hasMove = hasAnyLegalMove(s);
  const checked = inCheck(s, s.turn);
  if (!hasMove) {
    // No legal move: checkmate if in check, stalemate otherwise — both lose in
    // Shogi (true stalemate is essentially impossible because of drops).
    const winner = (s.turn ^ 1) as Player;
    return { kind: 'win', winner, reason: checked ? 'checkmate' : 'stalemate (no legal move)' };
  }
  if (checked) return { kind: 'check', player: s.turn };
  return { kind: 'playing' };
}

/* -------------------------------- Hand view ------------------------------ */

function getHand(s: ShogiState): HandPiece[] {
  const out: HandPiece[] = [];
  for (const player of [0, 1] as Player[]) {
    for (const kind of DROP_ORDER) {
      const count = s.hands[player][kind] ?? 0;
      if (count > 0) {
        out.push({ kind, player, count, glyph: GLYPH[kind as PieceType] });
      }
    }
  }
  return out;
}

/* ------------------------------- Board view ------------------------------ */

function getBoardView(s: ShogiState): BoardView {
  const cells = s.board.map((p, i) => ({
    index: i,
    row: rowOf(i),
    col: colOf(i),
    piece: p === null ? null : {
      id: `s${i}`,
      kind: kindOf(p),
      player: p.player,
      glyph: glyphFor(p),
      crowned: p.promoted,
    },
  }));
  return {
    rows: ROWS,
    cols: COLS,
    cells,
    fileLabels: FILES.slice(),
    rankLabels: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

function boardMaterial(s: ShogiState): { sente: number; gote: number } {
  let sente = 0;
  let gote = 0;
  for (const p of s.board) {
    if (!p || p.type === 'K') continue;
    if (p.player === 0) sente += pieceValue(p);
    else gote += pieceValue(p);
  }
  // Include hand pieces — captured material genuinely belongs to the holder.
  for (const k of DROP_ORDER) {
    sente += (s.hands[0][k] ?? 0) * VALUE[k as PieceType];
    gote += (s.hands[1][k] ?? 0) * VALUE[k as PieceType];
  }
  return { sente, gote };
}

/** Squares adjacent to `player`'s king (its "castle" core). */
function kingNeighbourhood(board: (Piece | null)[], player: Player): number[] {
  const kc = kingCell(board, player);
  if (kc < 0) return [];
  const r = rowOf(kc);
  const c = colOf(kc);
  const out: number[] = [];
  for (const [dr, dc] of KING_STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (onBoard(nr, nc)) out.push(idx(nr, nc));
  }
  return out;
}

function explainMove(before: ShogiState, move: ShogiMove, after: ShogiState): MoveExplanation {
  const mover = before.turn;
  const opp = (mover ^ 1) as Player;
  const side = sideName(mover);
  const adapter = searchAdapter();

  // Grade the played move against the engine's best at tutor depth.
  const res = searchBestMove(before, adapter, DEPTH.tutor);
  const playedRanked = res.ranked.find((r) => r.move.id === move.id);
  const playedScore = playedRanked ? playedRanked.score : evaluate(after);
  const bestScore = res.ranked[0]?.score ?? playedScore;
  const moverPlayed = mover === 0 ? playedScore : -playedScore;
  const moverBest = mover === 0 ? bestScore : -bestScore;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const isDrop = move.drop !== undefined;
  const captured = isDrop ? null : before.board[move.to];
  const movedPiece = isDrop ? null : before.board[move.from!];
  const promoted = move.promotion !== undefined;

  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;
  const givesCheck = inCheck(after, opp);

  // Distance of a drop from the enemy king (for "near the king" colour).
  const enemyKing = kingCell(before.board, opp);
  const dropNearKing =
    isDrop && enemyKing >= 0 &&
    Math.abs(rowOf(move.to) - rowOf(enemyKing)) + Math.abs(colOf(move.to) - colOf(enemyKing)) <= 2;

  if (won) {
    insights.push({
      tag: 'Checkmate!',
      detail: `${sideName(opp)}'s King has no escape — the game is over.`,
      tone: 'good',
    });
  }

  // Drops — the soul of Shogi.
  if (isDrop) {
    const name = PIECE_NAME[move.drop as PieceType];
    if (dropNearKing) {
      insights.push({
        tag: `Drops a ${name} by the King`,
        detail: `Parachuting the ${name.toLowerCase()} right next to ${sideName(opp)}'s King turns a captured piece into an instant attacker — the essence of Shogi.`,
        tone: 'good',
      });
      principles.push('Captured pieces re-enter as your own — dropping attackers around the enemy King is how most games are won.');
    } else {
      insights.push({
        tag: `Drops a ${name}`,
        detail: `A piece from hand re-enters the board, reinforcing the position for free — nothing is ever truly lost in Shogi.`,
        tone: 'good',
      });
      principles.push('A piece in hand is flexible firepower: hold drops until you can place them with maximum effect.');
    }
  }

  // Captures.
  if (captured) {
    const base = captured.type;
    insights.push({
      tag: `Captures a ${captured.promoted ? PROMOTED_NAME[base] : PIECE_NAME[base]}`,
      detail: base === 'K'
        ? 'Takes the King.'
        : `Wins the enemy ${(captured.promoted ? PROMOTED_NAME[base] : PIECE_NAME[base]).toLowerCase()} — and it now sits in ${side}'s hand, ready to be dropped back as a ${side} piece.`,
      tone: 'good',
    });
    if (base !== 'K') {
      threats.push(`${side} now holds a ${PIECE_NAME[base]} in hand to drop later.`);
      principles.push('Every capture is twice as valuable in Shogi: you remove an enemy unit and gain a piece to drop.');
    }
  }

  // Promotion.
  if (promoted && movedPiece) {
    const base = movedPiece.type;
    insights.push({
      tag: `Promotes to ${PROMOTED_NAME[base]}`,
      detail: base === 'R'
        ? 'The Rook becomes a Dragon — it keeps its rook lines and gains a one-step diagonal move.'
        : base === 'B'
          ? 'The Bishop becomes a Horse — it keeps its diagonals and gains a one-step orthogonal move.'
          : `The ${PIECE_NAME[base].toLowerCase()} promotes and now moves like a Gold — a big upgrade in close combat.`,
      tone: 'good',
    });
    principles.push('Promote in the farthest three ranks: most pieces become a Gold, while the Rook and Bishop become monsters.');
  }

  // Check.
  if (givesCheck && !won) {
    insights.push({
      tag: 'Check!',
      detail: `Attacks ${sideName(opp)}'s King — it must be answered at once, by capturing, blocking, or fleeing.`,
      tone: 'good',
    });
    threats.push(`${side} threatens the enemy King.`);
  }

  // King safety colour: did the mover reinforce its own castle, or is its king
  // dangerously short of guards?
  const myGuardsBefore = kingNeighbourhood(before.board, mover)
    .filter((i) => before.board[i] && before.board[i]!.player === mover).length;
  const myGuardsAfter = kingNeighbourhood(after.board, mover)
    .filter((i) => after.board[i] && after.board[i]!.player === mover).length;
  if (myGuardsAfter > myGuardsBefore) {
    insights.push({
      tag: 'Strengthens the castle',
      detail: 'Adds a defender beside your King — a well-guarded King is the backbone of a safe Shogi position.',
      tone: 'good',
    });
    principles.push('Build a castle: surround your King with Golds, Silvers and a screen of pawns before attacking.');
  } else if (!won && myGuardsAfter <= 1 && !inCheck(after, mover)) {
    insights.push({
      tag: 'King looks bare',
      detail: 'With few defenders around your King, a single enemy drop can start a mating net — consider castling.',
      tone: 'info',
    });
  }

  // Did the played move hang material — can the opponent grab a piece for less
  // than they gave? Compare against the best reply.
  if (!won) {
    const reply = searchBestMove(after, adapter, Math.max(1, DEPTH.medium - 1));
    if (reply.move && reply.move.capture) {
      const matBefore2 = boardMaterial(after);
      const replyState = applyMove(after, reply.move);
      const matReply = boardMaterial(replyState);
      const myNow = mover === 0 ? matBefore2.sente : matBefore2.gote;
      const myAfter2 = mover === 0 ? matReply.sente : matReply.gote;
      const netLoss = myNow - myAfter2; // material the reply strips from us (still ours if recaptured)
      const tookValue = captured ? pieceValue(captured) : 0;
      if (netLoss >= 250 && netLoss > tookValue) {
        insights.push({
          tag: 'Hangs material',
          detail: `This lets ${sideName(opp)} reply with ${reply.move.notation}, winning material the move did not have to concede.`,
          tone: 'bad',
        });
        threats.push(`${sideName(opp)} can play ${reply.move.notation}.`);
      }
    }
  }

  const winningBig = Math.abs(moverPlayed) > 700;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);

  if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
    insights.push({
      tag: 'Loses ground',
      detail: 'A stronger move was available; this one concedes material or initiative.',
      tone: 'bad',
    });
  }
  if (insights.length === 0) {
    insights.push({
      tag: 'Develops',
      detail: 'A sound, quiet move that improves a piece and keeps the position solid.',
      tone: 'info',
    });
  }

  const summary =
    won ? `${side} delivers checkmate (${move.notation})!`
    : isDrop && givesCheck ? `${side} drops a ${PIECE_NAME[move.drop as PieceType].toLowerCase()} with check (${move.notation}).`
    : isDrop ? `${side} drops a ${PIECE_NAME[move.drop as PieceType].toLowerCase()} onto ${sq(move.to)}.`
    : captured && promoted ? `${side} captures and promotes (${move.notation}).`
    : captured && givesCheck ? `${side} captures with check (${move.notation}).`
    : captured ? `${side} captures the ${(captured.promoted ? PROMOTED_NAME[captured.type] : PIECE_NAME[captured.type]).toLowerCase()} (${move.notation}).`
    : promoted ? `${side} promotes (${move.notation}).`
    : givesCheck ? `${side} gives check (${move.notation}).`
    : `${side} plays ${move.notation}.`;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 120 && res.move && res.move.id !== move.id
      ? `Stronger was ${res.move.notation}${res.move.capture ? ' — winning material' : res.move.drop ? ' — a powerful drop' : ''}.`
      : undefined,
  };
}

function hint(s: ShogiState): { move: ShogiMove; text: string } | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const mover = s.turn;
  const after = applyMove(s, m);
  const status = getStatus(after);
  const captured = m.drop !== undefined ? null : s.board[m.to];
  const givesCheck = inCheck(after, (mover ^ 1) as Player);

  const text =
    status.kind === 'win' && status.winner === mover
      ? `Play ${m.notation} — it is checkmate.`
    : m.drop !== undefined && givesCheck
      ? `Drop ${m.notation} — the dropped ${PIECE_NAME[m.drop as PieceType].toLowerCase()} gives check.`
    : m.drop !== undefined
      ? `Drop ${m.notation} — a captured piece re-enters where it does the most good.`
    : captured && givesCheck
      ? `Play ${m.notation} — a capture that also checks the King.`
    : givesCheck
      ? `Play ${m.notation} — it puts the enemy King in check.`
    : captured
      ? `Play ${m.notation} — it wins the ${(captured.promoted ? PROMOTED_NAME[captured.type] : PIECE_NAME[captured.type]).toLowerCase()}.`
    : m.promotion
      ? `Play ${m.notation} — promoting strengthens the piece.`
    : `${m.notation} is the strongest move here.`;
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<ShogiState, ShogiMove> = {
  id: 'shogi',
  name: 'Shogi',
  tagline: 'Japanese chess where captured pieces switch sides and rain back down as drops.',
  blurb:
    'Shogi — the chess of Japan — is famous for one electrifying twist: when you capture a piece it does not leave the game, it joins your hand, and on a later turn you can drop it back onto the board as one of your own. Armies never shrink, attacks never run out of ammunition, and even a losing position can roar back to life. Across a 9×9 board, eight kinds of piece advance and promote in the enemy camp; coordinate your forces, build a castle around your King, and use drops to weave an inescapable mating net. Checkmate the enemy King to win.',
  category: 'Strategy',
  depth: 5,
  emoji: '🇯🇵',
  accent: '#dc2626',
  players: [
    { id: 0, name: 'Sente', short: 'S', color: '#1f2937' },
    { id: 1, name: 'Gote', short: 'G', color: '#b91c1c' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'xiangqi', showCoordinates: true, checkered: false },

  createInitialState,
  cloneState,
  getBoardView,
  getTurn: (s) => s.turn,
  getStatus,
  getHand,
  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove,
  chooseMove,
  evaluate,
  explainMove,
  hint,

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => {
    const s = JSON.parse(str) as ShogiState;
    if (typeof s.ply !== 'number') s.ply = 0;
    if (!s.hands) s.hands = emptyHands();
    return s;
  },

  tutorial: {
    overview:
      'Shogi — Japanese chess — is played on a 9×9 board with flat, wedge-shaped pieces that all point at the enemy, so you can tell whose is whose only by which way they face. It shares chess\'s goal of checkmating the enemy King, but two rules transform it: pieces PROMOTE when they reach the enemy\'s ranks, and — most famously of all — captured pieces are not removed but kept "in hand" to be DROPPED back onto the board as your own. With no piece ever truly lost, Shogi is a furious, ever-renewing battle that millions in Japan play for life.',
    objective:
      'Checkmate the enemy King: attack it so that it cannot escape, the check cannot be blocked, and the attacker cannot be safely captured. A side that has no legal move at all also loses — but because you can almost always drop a piece, true stalemate essentially never happens. Sente (the dark pieces) moves first.',
    chapters: [
      {
        title: 'The Board & The Pieces', icon: '🇯🇵',
        steps: [
          {
            title: 'A 9×9 battlefield',
            body: 'Shogi is played on a grid of **9 files by 9 ranks** — 81 squares, unchequered. **Sente** (先手, "first player") sits along the bottom and **moves first**, marching up the board; **Gote** (後手, "second player") sits along the top and marches down. Because the pieces are identical wedges that simply point forward, the only way to tell the two armies apart is the direction they face.',
            highlight: [idx(8, 4), idx(0, 4)],
          },
          {
            title: 'The starting array',
            body: 'Each side fields **20 pieces**: one **King**, one **Rook**, one **Bishop**, two **Golds**, two **Silvers**, two **Knights**, two **Lances**, and **nine Pawns**. The back rank runs Lance–Knight–Silver–Gold–King–Gold–Silver–Knight–Lance; the Rook and Bishop stand on the second rank, and the nine pawns form a wall across the third.',
            highlight: [idx(8, 0), idx(8, 8), idx(7, 1), idx(7, 7)],
          },
          {
            title: 'The King, Gold and Silver',
            body: 'The **King** (玉) steps one square in any of the eight directions. The **Gold** (金) steps one square orthogonally or one square **diagonally forward** — six directions, but never diagonally backward. The **Silver** (銀) steps one square **straight forward** or to **any of the four diagonals** — strong on the attack but leaky behind. Golds defend; Silvers attack.',
            highlight: [idx(8, 4), idx(8, 3), idx(8, 5), idx(8, 2), idx(8, 6)],
          },
          {
            title: 'Knight, Lance and Pawn',
            body: 'The **Lance** (香) flies **any distance straight forward** but can never retreat. The **Knight** (桂) is the only jumper: it leaps to the **two squares two-forward-and-one-across**, and only forward. The **Pawn** (歩) plods **one square forward** — and unlike chess it captures straight ahead too. These short-range pieces become deadly once they promote.',
            highlight: [idx(8, 1), idx(8, 7), idx(6, 4)],
            arrows: [{ from: idx(8, 1), to: idx(6, 0), tone: 'info' }, { from: idx(8, 1), to: idx(6, 2), tone: 'info' }],
          },
          {
            title: 'The Rook and Bishop',
            body: 'The **Rook** (飛) slides **any distance orthogonally** and the **Bishop** (角) **any distance diagonally**, exactly as in chess — by far the two strongest pieces, the "big pieces". On the diagonal board the lone Bishop only ever reaches half the squares until it promotes. Winning the enemy Rook or Bishop, or trading yours well, often decides the game.',
            highlight: [idx(7, 7), idx(7, 1)],
            arrows: [{ from: idx(7, 7), to: idx(2, 7), tone: 'good' }, { from: idx(7, 1), to: idx(3, 3), tone: 'good' }],
          },
        ],
      },
      {
        title: 'Promotion', icon: '⭐',
        steps: [
          {
            title: 'The promotion zone',
            body: 'The farthest **three ranks** from your starting side are the **promotion zone** — for Sente the top three rows, for Gote the bottom three. A piece that **moves into, within, or out of** this zone may flip over to its stronger promoted side. Six of the eight pieces can promote; only the King and the Gold cannot.',
            highlight: [idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3), idx(0, 4), idx(0, 5), idx(0, 6), idx(0, 7), idx(0, 8), idx(1, 0), idx(1, 4), idx(1, 8), idx(2, 0), idx(2, 4), idx(2, 8)],
          },
          {
            title: 'Most pieces become Gold',
            body: 'When a **Silver, Knight, Lance or Pawn** promotes, it gains exactly the moves of a **Gold** (金) — a huge upgrade for these short-range pieces. A promoted Pawn (と, "tokin") in the enemy camp is a famous workhorse: cheap to make, annoying to remove, and lethal in numbers around the King.',
            highlight: [idx(2, 4)],
          },
          {
            title: 'Dragon and Horse',
            body: 'The big pieces promote into monsters. A promoted **Rook** is the **Dragon** (龍): it keeps every rook line **and** gains a one-square diagonal step. A promoted **Bishop** is the **Horse** (馬): all its diagonals **plus** a one-square orthogonal step. A Dragon or Horse near the enemy King is overwhelming.',
            highlight: [idx(2, 7), idx(2, 1)],
          },
          {
            title: 'Forced promotion',
            body: 'Promotion is usually optional, but sometimes it is **compulsory** — a piece may not be left somewhere it could never move again. A **Pawn or Lance** reaching the very last rank, or a **Knight** reaching either of the last two ranks, **must** promote. To keep things simple, this trainer **auto-promotes**: whenever a move into the zone is worth promoting, the piece simply flips — there is no extra click.',
            highlight: [idx(0, 0), idx(0, 8)],
          },
        ],
      },
      {
        title: 'The Drop Rule', icon: '🪂',
        steps: [
          {
            title: 'Captured pieces switch sides',
            body: 'This is the heart of Shogi. When you **capture** an enemy piece it is **not** removed from the game — it goes into your **hand**, flipped to your colour. A promoted piece reverts to its **base** form in hand (a captured Dragon becomes a plain Rook again). Your hand is shown beside the board.',
            highlight: [],
          },
          {
            title: 'Dropping a piece',
            body: 'Instead of moving a piece on the board, you may take **one piece from your hand and drop it onto any empty square** as your own — that is your whole turn. A dropped piece always arrives **unpromoted**, even deep in the enemy zone (it can promote later, on a normal move). Because nothing is ever truly lost, attacks in Shogi never run out of fuel.',
            highlight: [],
          },
          {
            title: 'Drop restrictions',
            body: 'A few squares are forbidden so a dropped piece is never stranded: a **Pawn or Lance** may not be dropped on the **last rank**, and a **Knight** may not be dropped on the **last two ranks** (it would have no move). You also may not drop a piece onto an occupied square. These mirror the forced-promotion rules.',
            highlight: [],
          },
          {
            title: 'Nifu — two pawns',
            body: 'One special restriction governs Pawns: the **nifu** ("two pawns") rule forbids dropping a Pawn on a **file that already holds one of your own unpromoted Pawns**. A promoted Pawn (tokin) on the file does not count, so you may drop again once your earlier pawn has promoted. (The rare "pawn-drop checkmate" rule is not enforced here.)',
            highlight: [],
          },
          {
            title: 'Why drops change everything',
            body: 'Drops make Shogi sharper and more decisive than chess: there are no dead drawn endings, a material edge is firepower you can deploy anywhere, and a single won Rook can be dropped as a Dragon-in-waiting beside the enemy King. Counting the pieces in **both** hands is as important as reading the board.',
            highlight: [],
          },
        ],
      },
      {
        title: 'Strategy', icon: '🏯',
        steps: [
          {
            title: 'Build a castle',
            body: 'Your King is fragile in the open, and the enemy can drop attackers right next to it — so before you attack, **castle**: shuffle your King to a corner and wrap it in a shell of **Golds, Silvers and pawns**. Famous castles like the Mino and the Yagura trade a few tempi now for a King that can survive a storm of drops later.',
            highlight: [idx(8, 1), idx(8, 2), idx(7, 1), idx(7, 2)],
          },
          {
            title: 'Big pieces and the edge',
            body: 'The **Rook** and **Bishop** are your power; keep them active and try to win the exchange of big pieces or promote one into a Dragon or Horse. Many openings are decided by whether you play a **Static Rook** (keeping it home) or a **Ranging Rook** (swinging it to the side to attack and castle on the far wing).',
            highlight: [idx(7, 7), idx(7, 1)],
          },
          {
            title: 'Attack with drops',
            body: 'Offence in Shogi is the art of the drop. Sacrifice a piece to tear a hole in the enemy castle, then **drop** fresh attackers — a Silver or a Gold — into the gap. A common pattern is to drop a Pawn to soften a defender, drop a Silver to break the shell, and finish with a Rook or Gold. Always know what is in your hand.',
            highlight: [],
          },
          {
            title: 'Tempo and the mating net',
            body: 'Because drops let you generate threats from nowhere, **tempo** is everything: keep checking and threatening so the enemy never gets a free move to drop on **you**. Games end not with a slow grind but with a sudden **mating net** — a flurry of checks and drops the King cannot escape. Read forcing sequences to the end before you commit.',
            highlight: [],
          },
          {
            title: 'How the tutor helps',
            body: 'In a live game the AI tutor grades **every** move — celebrating captures (and noting that the piece is now in your hand), drops near the enemy King, promotions to Dragon, Horse and tokin, and checks, while flagging a bare King or a hung piece and showing the stronger idea. Play at rising difficulty, read each explanation, and the rhythm of Shogi will start to click.',
            highlight: [],
          },
        ],
      },
    ],
  },
};

export default def;
