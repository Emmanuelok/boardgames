/**
 * Quarto — self-contained rules + AI. Sixteen unique pieces, each with four
 * binary traits (tall/short, dark/light, round/square, hollow/solid). On a 4×4
 * board you PLACE the piece your opponent handed you, then HAND your opponent
 * one of the remaining pieces. You win by completing a line (row, column or
 * diagonal) of four pieces that all share at least one trait. The twist: you
 * never choose your own piece, so you must avoid giving a winning one away.
 * Pure logic, no mutation of arguments.
 */
import { mulberry32, searchBestMove, WIN } from '../../engine/ai';
import { gradeMoveBySearch } from '../../engine/review';
import type { MoveExplanation, Player } from '../../engine/types';

// A piece is a 4-bit code: bit0 tall, bit1 dark, bit2 round, bit3 hollow.
export const TRAITS = ['tall', 'dark', 'round', 'hollow'] as const;
export const attr = (p: number, bit: number) => (p >> bit) & 1;

export interface QuartoState {
  board: (number | null)[]; // 16 cells, row*4+col; piece id 0..15 or null
  held: number | null; // the piece the current player must place (null only at the very start)
  turn: Player;
}
export interface QuartoMove { id: string; cell: number; give: number; notation: string } // give = -1 means "no piece left"

export function initialState(): QuartoState {
  return { board: Array(16).fill(null), held: null, turn: 0 };
}

const LINES: number[][] = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], // rows
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], // cols
  [0, 5, 10, 15], [3, 6, 9, 12], // diagonals
];

/** Four pieces share a trait if, for some bit, all four have the same value. */
function shareTrait(a: number, b: number, c: number, d: number): boolean {
  for (let bit = 0; bit < 4; bit++) {
    const v = attr(a, bit);
    if (attr(b, bit) === v && attr(c, bit) === v && attr(d, bit) === v) return true;
  }
  return false;
}

export function hasQuarto(board: (number | null)[]): boolean {
  return LINES.some((l) => l.every((i) => board[i] !== null) && shareTrait(board[l[0]]!, board[l[1]]!, board[l[2]]!, board[l[3]]!));
}
export const isFull = (board: (number | null)[]) => board.every((v) => v !== null);

export function available(s: QuartoState): number[] {
  const used = new Set<number>();
  for (const v of s.board) if (v !== null) used.add(v);
  if (s.held !== null) used.add(s.held);
  const out: number[] = [];
  for (let p = 0; p < 16; p++) if (!used.has(p)) out.push(p);
  return out;
}

const sq = (i: number) => `${String.fromCharCode(97 + (i % 4))}${4 - Math.floor(i / 4)}`;

export function legalMoves(s: QuartoState): QuartoMove[] {
  if (hasQuarto(s.board) || isFull(s.board)) return [];
  const avail = available(s);
  const out: QuartoMove[] = [];
  if (s.held === null) {
    // Opening: just hand a piece to the opponent (no placement yet).
    for (const g of avail) out.push({ id: `give-${g}`, cell: -1, give: g, notation: `give #${g}` });
    return out;
  }
  const empties: number[] = [];
  for (let i = 0; i < 16; i++) if (s.board[i] === null) empties.push(i);
  for (const cell of empties) {
    // If this placement wins, the give is moot — represent with give = -1.
    const test = s.board.slice(); test[cell] = s.held;
    if (hasQuarto(test)) { out.push({ id: `${cell}-win`, cell, give: -1, notation: `${sq(cell)} ✦` }); continue; }
    if (avail.length === 0) { out.push({ id: `${cell}-last`, cell, give: -1, notation: sq(cell) }); continue; }
    for (const g of avail) out.push({ id: `${cell}-${g}`, cell, give: g, notation: `${sq(cell)} → #${g}` });
  }
  return out;
}

export function applyMove(s: QuartoState, m: QuartoMove): QuartoState {
  const board = s.board.slice();
  if (m.cell >= 0 && s.held !== null) board[m.cell] = s.held;
  return { board, held: m.give >= 0 ? m.give : null, turn: (s.turn ^ 1) as Player };
}

/** Winner: a completed line means the player who JUST moved (turn^1) wins. */
export function winnerOf(s: QuartoState): Player | 'draw' | null {
  if (hasQuarto(s.board)) return (s.turn ^ 1) as Player;
  if (isFull(s.board)) return 'draw';
  return null;
}

/* --------------------------------- eval --------------------------------- */

/** Lines with three pieces sharing a trait and one empty cell — a live threat. */
function liveThreats(board: (number | null)[]): number {
  let n = 0;
  for (const l of LINES) {
    const vals = l.map((i) => board[i]);
    const filled = vals.filter((v) => v !== null) as number[];
    if (filled.length !== 3) continue;
    for (let bit = 0; bit < 4; bit++) {
      const v0 = attr(filled[0], bit);
      if (attr(filled[1], bit) === v0 && attr(filled[2], bit) === v0) { n++; break; }
    }
  }
  return n;
}

export function evaluate(s: QuartoState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  if (w === 'draw') return 0;
  // Threats favour whoever is on move (they hold a piece that might complete one).
  const t = liveThreats(s.board);
  return (s.turn === 0 ? 1 : -1) * t * 6;
}

// The place×give branching (~240 early) is enormous, so depth is capped — depth
// 2 already catches the key tactics (take a win; never give a winning piece).
const DEPTH: Record<string, number> = { easy: 1, medium: 2, hard: 2, master: 3 };
const RAND: Record<string, number> = { easy: 0.8, medium: 0.45, hard: 0.15, master: 0.04 };

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove,
    getTurn: (s: QuartoState) => s.turn,
    isTerminal: (s: QuartoState) => hasQuarto(s.board) || isFull(s.board),
    evaluate,
  };
}

export function chooseMove(s: QuartoState, difficulty: 'easy' | 'medium' | 'hard'): QuartoMove | null {
  const seed = (s.board.filter((v) => v !== null).length * 16 + (s.held ?? 0) + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/** Grade a played move for the post-game review (band + eval). */
export function gradeMove(before: QuartoState, move: QuartoMove, after: QuartoState): MoveExplanation {
  return gradeMoveBySearch(before, move, after, adapter(), { depth: 2, bigThreshold: 60 });
}

/* ----------------------------- coach commentary ----------------------------- */

export function moveComment(before: QuartoState, m: QuartoMove, after: QuartoState): { text: string; tone: 'good' | 'bad' | 'info' } {
  const who = before.turn; const name = who === 0 ? 'You' : 'Owl';
  if (winnerOf(after) === who) return { text: `${name} complete a line of four sharing a trait — ${who === 0 ? 'you win!' : 'Owl wins.'}`, tone: who === 0 ? 'good' : 'bad' };
  if (winnerOf(after) === 'draw') return { text: 'The board is full with no winning line — a draw.', tone: 'info' };
  if (m.cell < 0) return { text: `${name} hand over a piece to start.`, tone: 'info' };
  const threatsAfter = liveThreats(after.board);
  if (m.give >= 0 && before.held !== null) {
    // Did the piece handed over let the opponent win? (would be a blunder)
    const test = after; // opponent now holds m.give
    const oppCanWin = legalMoves(test).some((mv) => winnerOf(applyMove(test, mv)) === after.turn);
    if (oppCanWin) return { text: `${name} place on ${sq(m.cell)} but hand over a piece that completes a line — danger!`, tone: who === 0 ? 'bad' : 'good' };
  }
  return { text: `${name} place on ${sq(m.cell)} and pass a piece.${threatsAfter >= 2 ? ' Threats are building.' : ''}`, tone: 'info' };
}

export function coachTip(s: QuartoState): string {
  const w = winnerOf(s);
  if (w === 0) return 'Four in a line sharing a trait — won!';
  if (w === 1) return 'Owl completed a line — watch which piece you hand over next time.';
  if (w === 'draw') return 'A draw — the board filled with no shared-trait line.';
  if (s.held !== null) {
    const canWin = legalMoves(s).some((m) => winnerOf(applyMove(s, m)) === s.turn);
    if (canWin) return 'Your piece completes a line right now — find the winning square!';
    return 'Place your piece where it does the least for your opponent — then hand over a piece that can’t complete any line.';
  }
  return 'Before handing a piece over, check every line: never give a piece that completes four-sharing-a-trait.';
}
