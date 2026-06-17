/**
 * Ultimate Tic-Tac-Toe — self-contained rules + AI.
 *
 * Nine tic-tac-toe boards arranged in a 3×3 meta-grid. The twist: the CELL you
 * play in dictates which board your opponent must play in next. Win a small
 * board by three-in-a-row; win the GAME by winning three small boards in a row.
 * If you're sent to a board that's already decided, you may play anywhere.
 *
 * Indexing: cells[board*9 + cell]; board and cell are both 0..8 laid out
 * row-major (0,1,2 / 3,4,5 / 6,7,8). Pure logic, nothing mutated in place.
 */
import { mulberry32, searchBestMove, WIN } from '../../engine/ai';
import type { Player } from '../../engine/types';

export type Mark = Player; // 0 = X, 1 = O
export interface UTTTState {
  cells: (Mark | null)[];               // 81 cells
  boards: (Mark | 'draw' | null)[];     // 9 small-board results
  active: number;                       // forced board (0..8) or -1 = play anywhere
  turn: Player;                         // 0 = X (human), 1 = O (AI)
}
export interface UTTTMove { id: string; board: number; cell: number; notation: string }

export const POS = ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function initialState(): UTTTState {
  return { cells: Array(81).fill(null), boards: Array(9).fill(null), active: -1, turn: 0 };
}

/** Result of one small board from its nine cells. */
function subResult(sub: (Mark | null)[]): Mark | 'draw' | null {
  for (const [a, b, c] of LINES) if (sub[a] !== null && sub[a] === sub[b] && sub[b] === sub[c]) return sub[a] as Mark;
  return sub.every((v) => v !== null) ? 'draw' : null;
}

/** Meta winner from the nine board results (a 'draw' board belongs to neither). */
function metaWinner(boards: (Mark | 'draw' | null)[]): Mark | null {
  for (const [a, b, c] of LINES) { const v = boards[a]; if ((v === 0 || v === 1) && boards[b] === v && boards[c] === v) return v as Mark; }
  return null;
}

export function winnerOf(s: UTTTState): Mark | 'draw' | null {
  const m = metaWinner(s.boards);
  if (m !== null) return m;
  return s.boards.every((b) => b !== null) ? 'draw' : null;
}

/** Boards the side to move may play in (one if forced, else all still-open). */
export function playableBoards(s: UTTTState): number[] {
  if (s.active >= 0 && s.boards[s.active] === null) return [s.active];
  const out: number[] = [];
  for (let b = 0; b < 9; b++) if (s.boards[b] === null) out.push(b);
  return out;
}

export function legalMoves(s: UTTTState): UTTTMove[] {
  if (winnerOf(s) !== null) return [];
  const out: UTTTMove[] = [];
  for (const b of playableBoards(s)) {
    for (let c = 0; c < 9; c++) {
      if (s.cells[b * 9 + c] === null) out.push({ id: `${b}.${c}`, board: b, cell: c, notation: `${POS[b]}/${POS[c]}` });
    }
  }
  return out;
}

export function applyMove(s: UTTTState, m: UTTTMove): UTTTState {
  const cells = s.cells.slice();
  cells[m.board * 9 + m.cell] = s.turn;
  const boards = s.boards.slice();
  if (boards[m.board] === null) boards[m.board] = subResult(cells.slice(m.board * 9, m.board * 9 + 9));
  const active = boards[m.cell] === null ? m.cell : -1; // the chosen cell sends opponent to that board (unless decided)
  return { cells, boards, active, turn: (s.turn ^ 1) as Player };
}

/* --------------------------------- eval --------------------------------- */

const METAW = [3, 2, 3, 2, 4, 2, 3, 2, 3]; // a small board's worth by meta-position
const CELLW = [3, 2, 3, 2, 4, 2, 3, 2, 3]; // a cell's worth inside a small board

/** Small signed score for an undecided board (line threats + central control). */
function microEval(cells: (Mark | null)[], b: number): number {
  const base = b * 9; let s = 0;
  for (const [a, c, d] of LINES) {
    let x = 0, o = 0;
    for (const i of [a, c, d]) { const v = cells[base + i]; if (v === 0) x++; else if (v === 1) o++; }
    if (x > 0 && o > 0) continue;
    if (x === 2) s += 9; else if (x === 1) s += 2;
    if (o === 2) s -= 9; else if (o === 1) s -= 2;
  }
  for (let c = 0; c < 9; c++) { const v = cells[base + c]; if (v === 0) s += CELLW[c] * 0.4; else if (v === 1) s -= CELLW[c] * 0.4; }
  return s;
}

export function evaluate(s: UTTTState): number {
  const meta = metaWinner(s.boards);
  if (meta === 0) return WIN;
  if (meta === 1) return -WIN;
  if (s.boards.every((b) => b !== null)) return 0;
  let score = 0;
  for (let b = 0; b < 9; b++) {
    const r = s.boards[b];
    if (r === 0) score += METAW[b] * 100;
    else if (r === 1) score -= METAW[b] * 100;
    else if (r === null) score += microEval(s.cells, b);
  }
  for (const [a, b, c] of LINES) {
    let x = 0, o = 0, open = 0;
    for (const i of [a, b, c]) { const v = s.boards[i]; if (v === 0) x++; else if (v === 1) o++; else if (v === null) open++; }
    if (x > 0 && o > 0) continue;
    if (x === 2 && open === 1) score += 240;
    else if (o === 2 && open === 1) score -= 240;
    else if (x === 1 && open === 2) score += 28;
    else if (o === 1 && open === 2) score -= 28;
  }
  return score;
}

/* ----------------------------------- AI ----------------------------------- */

const DEPTH: Record<string, number> = { easy: 2, medium: 4, hard: 6 };
const RAND: Record<string, number> = { easy: 0.8, medium: 0.32, hard: 0.05 };

function order(s: UTTTState, m: UTTTMove): number {
  // Winning a small board first, central board/cell next — sharpens pruning.
  let v = CELLW[m.cell] + (m.board === 4 ? 2 : 0);
  const sub = s.cells.slice(m.board * 9, m.board * 9 + 9); sub[m.cell] = s.turn;
  if (subResult(sub) === s.turn) v += 20;
  return v;
}

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove,
    getTurn: (s: UTTTState) => s.turn,
    isTerminal: (s: UTTTState) => winnerOf(s) !== null,
    evaluate,
    order,
  };
}

export function chooseMove(s: UTTTState, difficulty: 'easy' | 'medium' | 'hard'): UTTTMove | null {
  const n = legalMoves(s).length;
  let depth = DEPTH[difficulty];
  if (n > 30) depth = Math.min(depth, 3);      // wide "play anywhere" nodes
  else if (n > 14) depth = Math.min(depth, 4);
  const filled = s.cells.filter((v) => v !== null).length;
  const seed = (filled + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), depth, { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ----------------------------- coach commentary ----------------------------- */

export interface UComment { text: string; tone: 'good' | 'bad' | 'info' }

export function moveComment(before: UTTTState, m: UTTTMove, after: UTTTState): UComment {
  const mover = before.turn; const who = mover === 0 ? 'You' : 'Nova'; const sym = mover === 0 ? 'X' : 'O';
  const v = (base: string) => (mover === 0 ? base : `${base}s`); // verb agreement: play → plays
  const w = winnerOf(after);
  if (w === 'draw') return { text: 'All nine boards are decided with no line of three — the game is a draw.', tone: 'info' };
  if (w === 0 || w === 1) {
    const youWon = w === 0;
    return { text: `${who} ${v('take')} three boards in a row — ${youWon ? 'you win the game! 🏆' : 'Nova wins the game.'}`, tone: youWon ? 'good' : 'bad' };
  }
  const wonBoard = before.boards[m.board] === null && after.boards[m.board] === mover;
  let txt = `${who} ${v('play')} ${sym} in the ${POS[m.cell]} cell of the ${POS[m.board]} board`;
  if (wonBoard) txt += `, winning that board`;
  txt += after.active === -1
    ? ` — ${mover === 0 ? 'Nova' : 'you'} can now play in any open board.`
    : ` — ${mover === 0 ? 'Nova' : 'you'} must play in the ${POS[after.active]} board next.`;
  const tone: UComment['tone'] = wonBoard ? (mover === 0 ? 'good' : 'bad') : 'info';
  return { text: txt, tone };
}

export function coachTip(s: UTTTState): string {
  const w = winnerOf(s);
  if (w === 0) return 'Three boards in a row — you win!';
  if (w === 1) return 'Nova lined up three boards — better luck next game.';
  if (w === 'draw') return 'A draw — every board decided with no winning meta-line.';
  if (s.turn === 1) return 'Nova is choosing where to play…';
  const where = s.active >= 0 ? `You must play in the ${POS[s.active]} board (it's highlighted).` : 'That board is decided, so you may play in ANY open board.';
  return `${where} Remember: the CELL you pick decides which board Nova plays next — try to send Nova into already-won boards, and win the small boards that line up three.`;
}
