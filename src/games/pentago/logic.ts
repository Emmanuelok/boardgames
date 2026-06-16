/**
 * Pentago — self-contained rules + AI. On a 6×6 board split into four 3×3
 * quadrants, a turn is: place one marble on any empty cell, then rotate ONE
 * quadrant 90° (either direction). First to get five of their marbles in a row
 * (orthogonal or diagonal) — AFTER the rotation — wins. If both reach five at
 * once, or the board fills with neither, it's a draw. Pure logic, no mutation.
 */
import { mulberry32, searchBestMove, WIN } from '../../engine/ai';
import type { Player } from '../../engine/types';

export type Cell = Player | null;
export interface PentagoState { board: Cell[]; turn: Player } // 36 cells, row*6+col
export interface PentagoMove { id: string; cell: number; quad: number; dir: 1 | -1; notation: string }

const N = 6;
// Top-left origin of each 3×3 quadrant (Q0 TL, Q1 TR, Q2 BL, Q3 BR).
const QORIGIN = [[0, 0], [0, 3], [3, 0], [3, 3]];

export function initialState(): PentagoState {
  return { board: Array(N * N).fill(null), turn: 0 };
}

/** All length-5 lines on the 6×6 board (precomputed). */
const LINES5: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells: number[] = []; let ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) { ok = false; break; }
        cells.push(rr * N + cc);
      }
      if (ok) out.push(cells);
    }
  }
  return out;
})();

export function hasFive(board: Cell[], p: Player): boolean {
  return LINES5.some((line) => line.every((i) => board[i] === p));
}
export const isFull = (board: Cell[]) => board.every((v) => v !== null);

/** Rotate quadrant `q` 90°: dir +1 = clockwise, -1 = counter-clockwise. */
export function rotate(board: Cell[], q: number, dir: 1 | -1): Cell[] {
  const next = board.slice();
  const [or, oc] = QORIGIN[q];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const src = (or + r) * N + (oc + c);
    const [nr, nc] = dir === 1 ? [c, 2 - r] : [2 - c, r]; // CW / CCW
    next[(or + nr) * N + (oc + nc)] = board[src];
  }
  return next;
}

const quadHasMarble = (board: Cell[], q: number) => {
  const [or, oc] = QORIGIN[q];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (board[(or + r) * N + (oc + c)] !== null) return true;
  return false;
};

const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;
const QNAME = ['↖', '↗', '↙', '↘'];

export function legalMoves(s: PentagoState): PentagoMove[] {
  const out: PentagoMove[] = [];
  for (let cell = 0; cell < N * N; cell++) {
    if (s.board[cell] !== null) continue;
    const placed = s.board.slice(); placed[cell] = s.turn;
    let emptyQ = -1;
    for (let q = 0; q < 4; q++) {
      if (!quadHasMarble(placed, q)) { if (emptyQ < 0) emptyQ = q; continue; }
      for (const dir of [1, -1] as const) {
        out.push({ id: `${cell}-${q}-${dir}`, cell, quad: q, dir, notation: `${sq(cell)} ${QNAME[q]}${dir === 1 ? '↻' : '↺'}` });
      }
    }
    // Rotating an empty quadrant is a legal no-op: "place and leave the board be".
    if (emptyQ >= 0) out.push({ id: `${cell}-${emptyQ}-1`, cell, quad: emptyQ, dir: 1, notation: sq(cell) });
  }
  return out;
}

export function applyMove(s: PentagoState, m: PentagoMove): PentagoState {
  const placed = s.board.slice(); placed[m.cell] = s.turn;
  const board = rotate(placed, m.quad, m.dir);
  return { board, turn: (s.turn ^ 1) as Player };
}

/** Result of the position: which player has five (or 'draw'/null). */
export function result(board: Cell[]): { winner: Player | null; draw: boolean } {
  const a = hasFive(board, 0), b = hasFive(board, 1);
  if (a && b) return { winner: null, draw: true };
  if (a) return { winner: 0, draw: false };
  if (b) return { winner: 1, draw: false };
  if (isFull(board)) return { winner: null, draw: true };
  return { winner: null, draw: false };
}

/* --------------------------------- eval --------------------------------- */

const SCORE = [0, 2, 14, 70, 500, 100000];
export function evaluate(s: PentagoState): number {
  const r = result(s.board);
  if (r.winner === 0) return WIN;
  if (r.winner === 1) return -WIN;
  if (r.draw) return 0;
  let score = 0;
  for (const line of LINES5) {
    let me = 0, opp = 0;
    for (const i of line) { const v = s.board[i]; if (v === 0) me++; else if (v === 1) opp++; }
    if (me > 0 && opp > 0) continue; // contested, dead line
    if (me > 0) score += SCORE[me];
    else if (opp > 0) score -= SCORE[opp];
  }
  return score; // + favours player 0
}

const DEPTH: Record<string, number> = { easy: 1, medium: 1, hard: 2, master: 2 };
const RAND: Record<string, number> = { easy: 0.7, medium: 0.35, hard: 0.1, master: 0 };

function adapter() {
  return {
    getLegalMoves: (s: PentagoState) => legalMoves(s),
    applyMove,
    getTurn: (s: PentagoState) => s.turn,
    isTerminal: (s: PentagoState) => { const r = result(s.board); return r.winner !== null || r.draw; },
    evaluate,
  };
}

export function chooseMove(s: PentagoState, difficulty: 'easy' | 'medium' | 'hard'): PentagoMove | null {
  const seed = (s.board.filter((v) => v !== null).length + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ----------------------------- coach commentary ----------------------------- */

function openFours(board: Cell[], p: Player): number {
  // lines with 4 of p and 1 empty (an immediate 5-threat)
  let n = 0;
  for (const line of LINES5) {
    let me = 0, empty = 0;
    for (const i of line) { const v = board[i]; if (v === p) me++; else if (v === null) empty++; }
    if (me === 4 && empty === 1) n++;
  }
  return n;
}

export function moveComment(before: PentagoState, m: PentagoMove, after: PentagoState): { text: string; tone: 'good' | 'bad' | 'info' } {
  const who = before.turn; const name = who === 0 ? 'You' : 'Blue';
  const r = result(after.board);
  if (r.winner === who) return { text: `${name} line up five — ${who === 0 ? 'you win!' : 'Blue wins.'}`, tone: who === 0 ? 'good' : 'bad' };
  if (r.draw) return { text: 'Five for both at once — it’s a draw!', tone: 'info' };
  const myThreatsBefore = openFours(before.board, who);
  const myThreatsAfter = openFours(after.board, who);
  const oppThreatsBefore = openFours(before.board, (who ^ 1) as Player);
  const oppThreatsAfter = openFours(after.board, (who ^ 1) as Player);
  if (myThreatsAfter > myThreatsBefore) return { text: `${name} place ${sq(m.cell)} and spin a quadrant — now threatening five!`, tone: who === 0 ? 'good' : 'bad' };
  if (oppThreatsAfter < oppThreatsBefore) return { text: `${name} rotate to break ${who === 0 ? 'Blue’s' : 'your'} threat — clever defence.`, tone: who === 0 ? 'good' : 'bad' };
  return { text: `${name} place ${sq(m.cell)} and rotate ${QNAME[m.quad]} ${m.dir === 1 ? 'clockwise' : 'anti-clockwise'}.`, tone: 'info' };
}

export function coachTip(s: PentagoState): string {
  const r = result(s.board);
  if (r.winner !== null) return r.winner === 0 ? 'Five in a row — game won!' : 'Blue found five — watch the rotations next time.';
  if (r.draw) return 'A draw — the board filled with no five.';
  if (openFours(s.board, 1) > 0) return 'Blue threatens five! Block it — or rotate the threatening quadrant to scatter it.';
  if (openFours(s.board, 0) > 0) return 'You’re threatening five — but remember your own rotation could break it. Spin a different quadrant.';
  return 'Every turn is place + rotate. A rotation can make your line OR destroy the opponent’s — always check both quadrants.';
}
