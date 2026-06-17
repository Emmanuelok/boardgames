/**
 * Order and Chaos — self-contained rules + AI (Stephen Sniderman, 1981).
 *
 * A 6×6 board and two symbols, X and O. The twist that makes it unlike any
 * other line game: on YOUR turn you may place EITHER symbol on any empty
 * square — both players share both pieces. The two players have opposite
 * goals. ORDER wins by making five-in-a-row of a single symbol (horizontal,
 * vertical or diagonal). CHAOS wins by filling the board with no such line.
 * One famous subtlety keeps it balanced: a row of SIX does NOT count — only
 * exactly five wins for Order.
 *
 * Pure logic; no argument is mutated. Player 0 = Order (maximiser), 1 = Chaos.
 */
import { mulberry32, searchBestMove, WIN } from '../../engine/ai';
import type { Player } from '../../engine/types';

export const N = 6;
export type Sym = 0 | 1; // 0 = X, 1 = O

export interface OCState { board: (Sym | null)[]; turn: Player } // turn 0 = Order, 1 = Chaos
export interface OCMove { id: string; cell: number; sym: Sym; notation: string }

export function initialState(): OCState {
  return { board: Array(N * N).fill(null), turn: 0 };
}

export const isFull = (b: (Sym | null)[]) => b.every((v) => v !== null);
export const symChar = (s: Sym) => (s === 0 ? 'X' : 'O');
const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;

// Right, down, down-right, down-left — enough to cover every line once.
const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

/**
 * Does the board contain a maximal run of EXACTLY five identical symbols?
 * Five-in-a-row wins for Order; a run of six does NOT count (the classic rule),
 * so we only fire on maximal runs whose length is precisely five.
 */
export function orderWins(board: (Sym | null)[]): boolean {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = board[r * N + c];
      if (v === null) continue;
      for (const [dr, dc] of DIRS) {
        // Only measure from the start of a run (previous cell differs / is off-board).
        const pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < N && pc >= 0 && pc < N && board[pr * N + pc] === v) continue;
        let len = 0, rr = r, cc = c;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === v) { len++; rr += dr; cc += dc; }
        if (len === 5) return true;
      }
    }
  }
  return false;
}

/** Order = 0, Chaos = 1, or null while the game continues. There are no draws. */
export function winnerOf(s: OCState): Player | null {
  if (orderWins(s.board)) return 0;
  if (isFull(s.board)) return 1;
  return null;
}

export function legalMoves(s: OCState): OCMove[] {
  if (winnerOf(s) !== null) return [];
  const out: OCMove[] = [];
  for (let i = 0; i < N * N; i++) {
    if (s.board[i] !== null) continue;
    out.push({ id: `${i}x`, cell: i, sym: 0, notation: `${sq(i)}=X` });
    out.push({ id: `${i}o`, cell: i, sym: 1, notation: `${sq(i)}=O` });
  }
  return out;
}

export function applyMove(s: OCState, m: OCMove): OCState {
  const board = s.board.slice();
  board[m.cell] = m.sym;
  return { board, turn: (s.turn ^ 1) as Player };
}

/* --------------------------------- eval --------------------------------- */

// Every length-5 window on the board (rows, columns, both diagonal directions).
const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + 4 * dr, ec = c + 4 * dc;
        if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
        const w: number[] = [];
        for (let k = 0; k < 5; k++) w.push((r + k * dr) * N + (c + k * dc));
        out.push(w);
      }
    }
  }
  return out;
})();

// Weight of a live (single-symbol) window by how many cells it already holds.
const WEIGHT = [0, 1, 6, 28, 130]; // index 0..4

export function evaluate(s: OCState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;   // Order made five — best for player 0
  if (w === 1) return -WIN;  // board filled, no five — Chaos wins
  let order = 0;
  for (const win of WINDOWS) {
    let x = 0, o = 0;
    for (const i of win) { const v = s.board[i]; if (v === 0) x++; else if (v === 1) o++; }
    if (x > 0 && o > 0) continue; // mixed window — dead, Chaos has poisoned it
    const k = x + o;
    if (k >= 5) continue; // a full single-symbol window not flagged as a win sits inside a 6-run — dead
    order += WEIGHT[k];
  }
  return order; // ≥ 0; bigger means Order is closer to a line
}

/** Cells where Order could complete five on the very next move (hot squares). */
export function orderThreats(board: (Sym | null)[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== null) continue;
    for (const sym of [0, 1] as Sym[]) {
      const b = board.slice(); b[i] = sym;
      if (orderWins(b)) { out.push(i); break; }
    }
  }
  return out;
}

/* ----------------------------------- AI ----------------------------------- */

const DEPTH: Record<string, number> = { easy: 2, medium: 2, hard: 3 };
const RAND: Record<string, number> = { easy: 0.85, medium: 0.4, hard: 0.08 };

// Cheap move ordering: central cells and cells touching existing symbols matter
// most, which makes alpha-beta prune the wide (≤72) move list hard.
function order(s: OCState, m: OCMove): number {
  const r = Math.floor(m.cell / N), c = m.cell % N;
  let score = 6 - (Math.abs(r - 2.5) + Math.abs(c - 2.5));
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N && s.board[rr * N + cc] !== null) score += 1;
  }
  return score;
}

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove,
    getTurn: (s: OCState) => s.turn,
    isTerminal: (s: OCState) => winnerOf(s) !== null,
    evaluate,
    order,
  };
}

export function chooseMove(s: OCState, difficulty: 'easy' | 'medium' | 'hard'): OCMove | null {
  const seed = (s.board.filter((v) => v !== null).length + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ----------------------------- coach commentary ----------------------------- */

export interface OCComment { text: string; tone: 'good' | 'bad' | 'info' }

export function moveComment(before: OCState, m: OCMove, after: OCState, human: Player = 0): OCComment {
  const mover = before.turn; // 0 = Order, 1 = Chaos
  const sym = symChar(m.sym);
  const mine = mover === human;
  const subj = mine ? 'You' : `${mover === 0 ? 'Order' : 'Chaos'} (AI)`;
  const v = (base: string) => (mine ? base : `${base}s`); // verb agreement: play → plays
  const w = winnerOf(after);

  if (w === 0) { // Order completed a five
    const youWon = human === 0;
    const how = mover === 1 ? `${v('complete')} a line of five` : `${v('complete')} five-in-a-row`;
    return { text: `${subj} ${v('place')} ${sym} on ${sq(m.cell)} and ${how} — ${youWon ? 'you win! 🏆' : 'Order wins.'}`, tone: youWon ? 'good' : 'bad' };
  }
  if (w === 1) { // Chaos filled the board with no five
    const youWon = human === 1;
    return { text: `The board is full with no line of five — ${youWon ? 'Chaos wins, you win! 🏆' : 'Chaos wins.'}`, tone: youWon ? 'good' : 'bad' };
  }

  const threats = orderThreats(after.board).length;
  if (mover === 0) { // Order built toward a line — good for whoever is Order
    const tone: OCComment['tone'] = human === 0 ? 'good' : 'bad';
    if (threats >= 2) return { text: `${subj} ${v('play')} ${sym} at ${sq(m.cell)} — that makes ${threats} winning squares at once; only one can be blocked!`, tone };
    if (threats === 1) return { text: `${subj} ${v('play')} ${sym} at ${sq(m.cell)} — one square now completes five and must be blocked.`, tone: 'info' };
    return { text: `${subj} ${v('play')} ${sym} at ${sq(m.cell)}, building toward a five.`, tone: 'info' };
  }
  // Chaos poisoned lines — good for whoever is Chaos.
  if (threats === 0) return { text: `${subj} ${v('play')} ${sym} at ${sq(m.cell)}, mixing symbols to poison the lines — no five available.`, tone: human === 1 ? 'good' : 'bad' };
  return { text: `${subj} ${v('play')} ${sym} at ${sq(m.cell)}, but a winning square stays open for Order!`, tone: human === 1 ? 'bad' : 'good' };
}

export function coachTip(s: OCState, human: Player = 0): string {
  const w = winnerOf(s);
  if (w !== null) {
    if (w === 0) return human === 0 ? 'Five in a line — you win as Order!' : 'Order lined up five — Chaos (you) couldn’t stop it.';
    return human === 1 ? 'The board filled with no five — you win as Chaos!' : 'The board filled with no line of five — Chaos wins.';
  }
  const threats = orderThreats(s.board);
  const yourTurn = s.turn === human;
  if (human === 0) { // human plays Order
    if (yourTurn && threats.length) return 'You can win now — drop the matching symbol on a glowing square to make five.';
    if (yourTurn) return 'You are Order: build FIVE of one symbol. Aim for a double threat — two winning squares so Chaos can’t block both.';
    return 'Chaos (AI) is poisoning your lines with the opposite symbol — keep two threats alive at once.';
  }
  // human plays Chaos
  if (threats.length) return yourTurn
    ? 'Danger: Order can complete five on a glowing square. Block it — drop the OTHER symbol there.'
    : 'Order has a winning square ready. On your turn you must neutralise it.';
  if (yourTurn) return 'You are Chaos: stop every five. Poison lines that hold three of a kind, and remember — six does NOT count.';
  return 'Order (AI) is trying to line up five — get ready to poison its strongest line on your turn.';
}
