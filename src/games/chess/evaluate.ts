/**
 * Static evaluation, returned in centipawns from White's point of view
 * (positive favours White = player 0). Combines material, piece-square
 * tables (tapered for the king between midd+endgame), the bishop pair,
 * pawn-structure terms and a light king-safety shield.
 */
import { Position, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, fileOf, rankOf } from './engine';

export const MATERIAL: Record<number, number> = {
  [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 0,
};

// All tables are written visually from rank 8 (top row) down to rank 1, which
// is exactly this engine's board order (index 0 = a8). They encode good squares
// for WHITE; a black piece on square `sq` reads the table at `sq ^ 56`.
const PAWN_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const KNIGHT_PST = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
const BISHOP_PST = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
const ROOK_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const QUEEN_PST = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
const KING_MG_PST = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
const KING_EG_PST = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const PST: Record<number, number[]> = {
  [PAWN]: PAWN_PST, [KNIGHT]: KNIGHT_PST, [BISHOP]: BISHOP_PST,
  [ROOK]: ROOK_PST, [QUEEN]: QUEEN_PST,
};

export const MATE = 100000;

const ROOK_DIR = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_DIR = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// Bonus for a passed pawn, indexed by how many ranks it has advanced (0..7).
const PASSED = [0, 8, 14, 24, 42, 68, 100, 0];

/** Sliding mobility: count reachable squares (empty or capture) along `dirs`. */
function mobility(b: Int8Array, sq: number, dirs: number[][]): number {
  const f = fileOf(sq), r = rankOf(sq);
  let n = 0;
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = f + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = b[rr * 8 + cc];
      n++;
      if (p !== 0) break;
      rr += dr; cc += dc;
    }
  }
  return n;
}

export function evaluatePosition(pos: Position): number {
  const b = pos.board;
  let mg = 0, eg = 0, phase = 0;
  let whiteBishops = 0, blackBishops = 0;
  const pawnFilesW = [0, 0, 0, 0, 0, 0, 0, 0];
  const pawnFilesB = [0, 0, 0, 0, 0, 0, 0, 0];
  const PHASE_W: Record<number, number> = { [KNIGHT]: 1, [BISHOP]: 1, [ROOK]: 2, [QUEEN]: 4 };
  const pawnsW: number[] = [], pawnsB: number[] = [], rooksW: number[] = [], rooksB: number[] = [];
  let wK = -1, bK = -1;

  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === 0) continue;
    const t = Math.abs(p);
    const white = p > 0;
    const mirror = white ? sq : sq ^ 56;
    if (t === KING) {
      if (white) { wK = sq; mg += KING_MG_PST[mirror]; eg += KING_EG_PST[mirror]; }
      else { bK = sq; mg -= KING_MG_PST[mirror]; eg -= KING_EG_PST[mirror]; }
      continue;
    }
    const val = MATERIAL[t] + PST[t][mirror];
    if (white) { mg += val; eg += val; } else { mg -= val; eg -= val; }
    phase += PHASE_W[t] ?? 0;
    if (t === BISHOP) white ? whiteBishops++ : blackBishops++;
    if (t === PAWN) { (white ? pawnFilesW : pawnFilesB)[fileOf(sq)]++; (white ? pawnsW : pawnsB).push(sq); }
    if (t === ROOK) (white ? rooksW : rooksB).push(sq);

    // Mobility (sliders).
    if (t === BISHOP || t === ROOK || t === QUEEN) {
      const dirs = t === BISHOP ? BISHOP_DIR : t === ROOK ? ROOK_DIR : ROOK_DIR.concat(BISHOP_DIR);
      const m = (mobility(b, sq, dirs) - 6) * (t === QUEEN ? 1 : 3);
      if (white) { mg += m; eg += m; } else { mg -= m; eg -= m; }
    }
  }

  if (whiteBishops >= 2) { mg += 30; eg += 40; }
  if (blackBishops >= 2) { mg -= 30; eg -= 40; }

  // Pawn structure: doubled & isolated.
  for (let f = 0; f < 8; f++) {
    if (pawnFilesW[f] > 1) { mg -= 12 * (pawnFilesW[f] - 1); eg -= 18 * (pawnFilesW[f] - 1); }
    if (pawnFilesB[f] > 1) { mg += 12 * (pawnFilesB[f] - 1); eg += 18 * (pawnFilesB[f] - 1); }
    const wIso = pawnFilesW[f] > 0 && (f === 0 || pawnFilesW[f - 1] === 0) && (f === 7 || pawnFilesW[f + 1] === 0);
    const bIso = pawnFilesB[f] > 0 && (f === 0 || pawnFilesB[f - 1] === 0) && (f === 7 || pawnFilesB[f + 1] === 0);
    if (wIso) { mg -= 14; eg -= 18; }
    if (bIso) { mg += 14; eg += 18; }
  }

  // Passed pawns (white advances toward row 0; black toward row 7).
  for (const sq of pawnsW) {
    const f = fileOf(sq), r = rankOf(sq);
    const blocked = pawnsB.some((q) => Math.abs(fileOf(q) - f) <= 1 && rankOf(q) < r);
    if (!blocked) { const adv = 6 - r; mg += PASSED[adv] >> 1; eg += PASSED[adv]; }
  }
  for (const sq of pawnsB) {
    const f = fileOf(sq), r = rankOf(sq);
    const blocked = pawnsW.some((q) => Math.abs(fileOf(q) - f) <= 1 && rankOf(q) > r);
    if (!blocked) { const adv = r - 1; mg -= PASSED[adv] >> 1; eg -= PASSED[adv]; }
  }

  // Rooks on open / semi-open files.
  for (const sq of rooksW) {
    const f = fileOf(sq);
    if (pawnFilesW[f] === 0) { mg += pawnFilesB[f] === 0 ? 22 : 11; eg += 8; }
  }
  for (const sq of rooksB) {
    const f = fileOf(sq);
    if (pawnFilesB[f] === 0) { mg -= pawnFilesW[f] === 0 ? 22 : 11; eg -= 8; }
  }

  if (wK >= 0 && rankOf(wK) >= 6) mg += shield(b, wK, true);
  if (bK >= 0 && rankOf(bK) <= 1) mg -= shield(b, bK, false);

  const phaseClamped = Math.min(24, phase);
  return Math.round((mg * phaseClamped + eg * (24 - phaseClamped)) / 24);
}

function shield(b: Int8Array, kSq: number, white: boolean): number {
  const f = fileOf(kSq);
  const dir = white ? -8 : 8;
  const pawn = white ? PAWN : -PAWN;
  let s = 0;
  for (const df of [-1, 0, 1]) {
    const nf = f + df;
    if (nf < 0 || nf > 7) continue;
    const front = kSq + dir + df;
    if (front >= 0 && front < 64 && b[front] === pawn) s += 10;
  }
  return s;
}
