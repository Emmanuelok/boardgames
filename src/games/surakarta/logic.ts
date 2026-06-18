/**
 * Surakarta — self-contained rules + AI. (Documented loop interpretation.)
 *
 * A 6×6 grid of points. Pieces make a SIMPLE move (one step to any of the 8
 * adjacent empty points) or a CAPTURE: they travel along a rank/file, ride at
 * least one of the eight corner LOOPS, and take the first enemy piece on the
 * track (the path must be clear). The loops join the outer lines (rows/cols 0 &
 * 5) into the perimeter circuit and the next-in lines (rows/cols 1 & 4) into an
 * inner circuit; rows/cols 2 & 3 carry no loop, so the central four points can
 * neither capture nor be captured — the classic Surakarta "safe" centre.
 *
 * Take all of the opponent's pieces (or leave them with no move) to win. A long
 * spell with no capture is a draw, which bounds the game. Pure logic.
 */
import { mulberry32, searchBestMove, WIN } from '../../engine/ai';
import { gradeMoveBySearch } from '../../engine/review';
import type { MoveExplanation, Player } from '../../engine/types';

export const SIZE = 6;
const N = SIZE * SIZE;
const NO_CAPTURE_DRAW = 40;

export interface SkState { points: (Player | null)[]; turn: Player; sinceCapture: number }
export interface SkMove { id: string; from: number; to: number; notation: string; capture?: boolean; affected?: number[]; via?: number[] }

export const rowOf = (i: number) => Math.floor(i / SIZE);
export const colOf = (i: number) => i % SIZE;
const idx = (r: number, c: number) => r * SIZE + c;
const onBoard = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const FILES = ['a', 'b', 'c', 'd', 'e', 'f'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;

type Dir = 'U' | 'D' | 'L' | 'R';
const DELTA: Record<Dir, [number, number]> = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };

/** Corner-loop transitions: leaving the board at (point, dir) re-enters at {point, dir}. */
const TRANS: Record<string, { point: number; dir: Dir }> = {};
const addLoop = (p: number, d: Dir, q: number, e: Dir) => { TRANS[`${p}|${d}`] = { point: q, dir: e }; };
// Outer loops (perimeter): the four corners turn the edge lines into one circuit.
addLoop(idx(0, 0), 'L', idx(0, 0), 'D'); addLoop(idx(0, 0), 'U', idx(0, 0), 'R');
addLoop(idx(0, 5), 'R', idx(0, 5), 'D'); addLoop(idx(0, 5), 'U', idx(0, 5), 'L');
addLoop(idx(5, 0), 'L', idx(5, 0), 'U'); addLoop(idx(5, 0), 'D', idx(5, 0), 'R');
addLoop(idx(5, 5), 'R', idx(5, 5), 'U'); addLoop(idx(5, 5), 'D', idx(5, 5), 'L');
// Inner loops (rows/cols 1 & 4) — each arc joins two distinct edge points.
addLoop(idx(1, 0), 'L', idx(0, 1), 'D'); addLoop(idx(0, 1), 'U', idx(1, 0), 'R');
addLoop(idx(1, 5), 'R', idx(0, 4), 'D'); addLoop(idx(0, 4), 'U', idx(1, 5), 'L');
addLoop(idx(4, 0), 'L', idx(5, 1), 'U'); addLoop(idx(5, 1), 'D', idx(4, 0), 'R');
addLoop(idx(4, 5), 'R', idx(5, 4), 'U'); addLoop(idx(5, 4), 'D', idx(4, 5), 'L');

export function initialState(): SkState {
  const points: (Player | null)[] = Array(N).fill(null);
  for (let i = 0; i < N; i++) { const r = rowOf(i); if (r <= 1) points[i] = 1; else if (r >= 4) points[i] = 0; }
  return { points, turn: 0, sinceCapture: 0 };
}
const cloneState = (s: SkState): SkState => ({ points: s.points.slice(), turn: s.turn, sinceCapture: s.sinceCapture });

/**
 * Trace a capture ray from `start` in orthogonal direction `dir`. Returns the
 * captured square (first enemy reached AFTER riding ≥1 loop, path clear) and the
 * track travelled, or null if the ray dies, circles back, or is blocked early.
 */
export function captureRay(points: (Player | null)[], start: number, dir: Dir): { target: number; via: number[] } | null {
  let cur = start, d = dir, loops = 0, steps = 0;
  const via: number[] = [];
  while (steps++ < 120) {
    const [dr, dc] = DELTA[d];
    const nr = rowOf(cur) + dr, nc = colOf(cur) + dc;
    if (onBoard(nr, nc)) {
      cur = idx(nr, nc);
    } else {
      const t = TRANS[`${cur}|${d}`];
      if (!t) return null;          // edge with no loop — ray dies
      loops++;
      if (t.point === cur) { d = t.dir; continue; }  // outer corner: just turn
      cur = t.point; d = t.dir;     // inner arc: jump to the joined point
    }
    if (cur === start) return null; // full circuit, nothing taken
    via.push(cur);
    if (points[cur] !== null) {
      return loops >= 1 && points[cur] !== points[start] ? { target: cur, via } : null;
    }
  }
  return null;
}

const DIAG8: Dir[] = ['U', 'D', 'L', 'R'];
const STEP8: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

export function legalMoves(s: SkState, fromCell?: number | null): SkMove[] {
  if (winnerOf(s) !== null) return [];
  const out: SkMove[] = [];
  for (let i = 0; i < N; i++) {
    if (s.points[i] !== s.turn) continue;
    // Simple steps to any adjacent empty point (orthogonal + diagonal).
    for (const [dr, dc] of STEP8) {
      const nr = rowOf(i) + dr, nc = colOf(i) + dc;
      if (onBoard(nr, nc) && s.points[idx(nr, nc)] === null) out.push({ id: `m${i}-${idx(nr, nc)}`, from: i, to: idx(nr, nc), notation: `${sq(i)}–${sq(idx(nr, nc))}` });
    }
    // Captures along the four loop tracks.
    for (const d of DIAG8) {
      const cap = captureRay(s.points, i, d);
      if (cap) out.push({ id: `x${i}-${cap.target}-${d}`, from: i, to: cap.target, notation: `${sq(i)}×${sq(cap.target)}`, capture: true, affected: [cap.target], via: cap.via });
    }
  }
  // De-duplicate captures that reach the same target from both directions (keep the shorter path).
  const seen = new Map<string, SkMove>();
  const res: SkMove[] = [];
  for (const m of out) {
    if (!m.capture) { res.push(m); continue; }
    const k = `${m.from}-${m.to}`;
    const prev = seen.get(k);
    if (!prev || (m.via?.length ?? 0) < (prev.via?.length ?? 0)) seen.set(k, m);
  }
  res.push(...seen.values());
  return fromCell != null ? res.filter((m) => m.from === fromCell) : res;
}

export function applyMove(s: SkState, m: SkMove): SkState {
  const points = s.points.slice();
  points[m.to] = s.turn;
  points[m.from] = null;
  return { points, turn: (s.turn ^ 1) as Player, sinceCapture: m.capture ? 0 : s.sinceCapture + 1 };
}

const count = (s: SkState, p: Player) => s.points.reduce<number>((n, v) => n + (v === p ? 1 : 0), 0);

export function winnerOf(s: SkState): Player | 'draw' | null {
  if (count(s, 0) === 0) return 1;
  if (count(s, 1) === 0) return 0;
  if (s.sinceCapture >= NO_CAPTURE_DRAW) return 'draw';
  // No legal simple/capture move for the side to move → they lose. (Checked without recursion.)
  if (!hasAnyMove(s)) return (s.turn ^ 1) as Player;
  return null;
}

function hasAnyMove(s: SkState): boolean {
  for (let i = 0; i < N; i++) {
    if (s.points[i] !== s.turn) continue;
    for (const [dr, dc] of STEP8) { const nr = rowOf(i) + dr, nc = colOf(i) + dc; if (onBoard(nr, nc) && s.points[idx(nr, nc)] === null) return true; }
    for (const d of DIAG8) if (captureRay(s.points, i, d)) return true;
  }
  return false;
}

/* ------------------------------- Evaluation ------------------------------ */
const CENTER = new Set([idx(2, 2), idx(2, 3), idx(3, 2), idx(3, 3)]);
export function evaluate(s: SkState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  if (w === 'draw') return 0;
  let score = 0;
  for (let i = 0; i < N; i++) {
    const v = s.points[i]; if (v === null) continue;
    const sign = v === 0 ? 1 : -1;
    score += sign * 100;                       // material is everything in Surakarta
    if (CENTER.has(i)) score += sign * 6;       // the uncapturable centre is a safe haven
    score += sign * (2.5 - Math.abs(rowOf(i) - 2.5)) * 1.5; // advance off the home rank to engage
  }
  // Reward having captures available — encourages lining pieces up on the loops.
  let t0 = 0, t1 = 0;
  for (let i = 0; i < N; i++) {
    const v = s.points[i]; if (v === null) continue;
    for (const d of DIAG8) if (captureRay(s.points, i, d)) { if (v === 0) t0++; else t1++; break; }
  }
  score += (t0 - t1) * 14;
  return score;
}

function adapter() {
  return {
    getLegalMoves: (s: SkState) => legalMoves(s),
    applyMove,
    getTurn: (s: SkState) => s.turn,
    isTerminal: (s: SkState) => winnerOf(s) !== null,
    evaluate,
    order: (_s: SkState, m: SkMove) => (m.capture ? 50 : 0),
  };
}

const DEPTH: Record<string, number> = { tutor: 4, easy: 2, medium: 3, hard: 4, master: 4 };
const RAND: Record<string, number> = { tutor: 0, easy: 0.7, medium: 0.34, hard: 0.07, master: 0 };

export function chooseMove(s: SkState, difficulty: 'tutor' | 'easy' | 'medium' | 'hard' | 'master'): SkMove | null {
  const seed = (s.points.reduce<number>((a, v, i) => a + (v !== null ? i * (v + 1) : 0), 0) + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

export function gradeMove(before: SkState, move: SkMove, after: SkState): MoveExplanation {
  return gradeMoveBySearch(before, move, after, adapter(), { depth: 3, bigThreshold: 250 });
}

/* ----------------------------- coach commentary ----------------------------- */
export interface SkComment { text: string; tone: 'good' | 'bad' | 'info' }

export function moveComment(before: SkState, m: SkMove, after: SkState): SkComment {
  const mover = before.turn; const who = mover === 0 ? 'You' : 'Sphinx';
  const w = winnerOf(after);
  if (w === 0 || w === 1) return { text: `${w === mover ? who + ' capture the last piece' : 'Sphinx clears the board'} — ${w === 0 ? 'you win! 🏆' : 'Sphinx wins.'}`, tone: w === 0 ? 'good' : 'bad' };
  if (w === 'draw') return { text: '40 moves with no capture — a draw.', tone: 'info' };
  if (m.capture) {
    const left = count(after, (mover ^ 1) as Player);
    return { text: `${who} loop around to capture on ${sq(m.to)} — ${mover === 0 ? 'Sphinx' : 'you'} now ${mover === 0 ? 'has' : 'have'} ${left} piece${left === 1 ? '' : 's'} left.`, tone: mover === 0 ? 'good' : 'bad' };
  }
  return { text: `${who} slide ${sq(m.from)}→${sq(m.to)}, lining up the loops.`, tone: 'info' };
}

export function coachTip(s: SkState): string {
  const w = winnerOf(s);
  if (w === 0) return 'Every enemy piece captured — you win!';
  if (w === 1) return 'Sphinx took all your pieces.';
  if (w === 'draw') return 'A draw — 40 moves passed with no capture.';
  if (s.turn === 1) return 'Sphinx is tracing the loops…';
  const caps = legalMoves(s).filter((m) => m.capture).length;
  if (caps > 0) return `You have ${caps} capture${caps === 1 ? '' : 's'} available — a capturing piece rides a corner loop to land on its target. Captures aren't forced, so weigh each one.`;
  return 'No captures yet. Slide pieces onto the rank/file loops so they can sweep around a corner — and remember the four central points are safe from capture.';
}
