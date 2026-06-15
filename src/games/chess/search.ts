/**
 * The chess brain: iterative-deepening alpha-beta (negamax) with a quiescence
 * search, MVV-LVA + killer move ordering, a compact opening book and
 * difficulty tuning. Exposes:
 *   - `bestMove`  : choose a move for the AI at a given difficulty.
 *   - `analyze`   : score every root move (used by the tutor and the Hint button).
 */
import { Position as Pos, type ChessMove as CMove, type ChessState as CState, WHITE } from './engine';
import { evaluatePosition, MATE, MATERIAL } from './evaluate';
import { OPENING_BOOK, positionKey } from './book';
import type { Difficulty } from '../../engine/types';

const INF = 1e9;

let killers: Record<number, string[]> = {};
let nodes = 0;
let deadline = 0;

function evalSTM(pos: Pos): number {
  const e = evaluatePosition(pos);
  return pos.turn === WHITE ? e : -e;
}

function scoreMove(m: CMove, ply: number): number {
  let s = 0;
  if (m.capture) {
    const victim = m.captured ? MATERIAL[Math.abs(m.captured)] : 100; // EP captures a pawn
    const attacker = MATERIAL[Math.abs(m.piece)] || 1;
    s += 100000 + victim * 16 - attacker;
  }
  if (m.promo) s += 90000 + MATERIAL[m.promo];
  const k = killers[ply];
  if (k && (k[0] === m.id || k[1] === m.id)) s += 80000;
  return s;
}

function order(moves: CMove[], ply: number): CMove[] {
  return moves
    .map((m) => ({ m, s: scoreMove(m, ply) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function addKiller(id: string, ply: number) {
  const k = killers[ply] || (killers[ply] = []);
  if (k[0] !== id) { k[1] = k[0]; k[0] = id; }
}

function quiesce(pos: Pos, alpha: number, beta: number): number {
  nodes++;
  const standPat = evalSTM(pos);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  // Only noisy moves: captures and promotions.
  const caps = pos.legalMoves().filter((m) => m.capture || m.promo);
  caps.sort((a, b) => scoreMove(b, 64) - scoreMove(a, 64));
  for (const m of caps) {
    pos.make(m);
    const score = -quiesce(pos, -beta, -alpha);
    pos.unmake();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(pos: Pos, depth: number, alpha: number, beta: number, ply: number): number {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > deadline) return alpha; // soft time-out
  if (depth <= 0) return quiesce(pos, alpha, beta);

  const moves = pos.legalMoves();
  if (moves.length === 0) {
    return pos.inCheck(pos.turn) ? -MATE + ply : 0; // checkmate vs stalemate
  }
  // 50-move rule (cheap draw detection).
  if (pos.half >= 100) return 0;

  const ordered = order(moves, ply);
  let best = -INF;
  for (const m of ordered) {
    pos.make(m);
    const score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    pos.unmake();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) { if (!m.capture) addKiller(m.id, ply); break; }
  }
  return best;
}

export interface Ranked { move: CMove; score: number; } // score from mover's perspective
export interface SearchOut { best: CMove | null; score: number; ranked: Ranked[]; depth: number; nodes: number; }

/** Full-window search of every root move so scores are comparable (for ranking). */
export function analyze(state: CState, maxDepth: number, timeMs = 1500): SearchOut {
  const pos = new Pos(state);
  let roots = pos.legalMoves();
  for (const m of roots) m.notation = pos.toSAN(m);
  if (roots.length === 0) return { best: null, score: evalSTM(pos), ranked: [], depth: 0, nodes: 0 };

  killers = {};
  nodes = 0;
  deadline = Date.now() + timeMs;
  let ranked: Ranked[] = roots.map((m) => ({ move: m, score: 0 }));

  for (let d = 1; d <= maxDepth; d++) {
    const local: Ranked[] = [];
    // Search previous-best first for better pruning inside.
    const orderRoots = [...roots].sort((a, b) => rankScore(ranked, b) - rankScore(ranked, a));
    let timedOut = false;
    for (const m of orderRoots) {
      pos.make(m);
      const score = -negamax(pos, d - 1, -INF, INF, 1);
      pos.unmake();
      local.push({ move: m, score });
      if (Date.now() > deadline) { timedOut = true; break; }
    }
    if (local.length === roots.length) {
      local.sort((a, b) => b.score - a.score);
      ranked = local;
    }
    if (timedOut || Date.now() > deadline) { return finalize(ranked, d, pos); }
  }
  return finalize(ranked, maxDepth, pos);
}

function rankScore(ranked: Ranked[], m: CMove): number {
  return ranked.find((r) => r.move.id === m.id)?.score ?? 0;
}
function finalize(ranked: Ranked[], depth: number, pos: Pos): SearchOut {
  return { best: ranked[0]?.move ?? null, score: ranked[0]?.score ?? evalSTM(pos), ranked, depth, nodes };
}

const SETTINGS: Record<Difficulty, { depth: number; time: number; slack: number; blunder: number }> = {
  tutor: { depth: 4, time: 700, slack: 0, blunder: 0 },
  easy: { depth: 2, time: 300, slack: 220, blunder: 0.35 },
  medium: { depth: 3, time: 600, slack: 90, blunder: 0.12 },
  hard: { depth: 5, time: 1400, slack: 25, blunder: 0 },
  master: { depth: 7, time: 3000, slack: 0, blunder: 0 },
};

/** Choose the AI's move, including opening-book variety and difficulty flavour. */
export function bestMove(state: CState, difficulty: Difficulty, rng: () => number = Math.random): CMove | null {
  const pos = new Pos(state);
  const legal = pos.legalMoves();
  for (const m of legal) m.notation = pos.toSAN(m);
  if (legal.length === 0) return null;

  // Opening book (skip on master sometimes to vary, but mostly use for natural play).
  const bookMoves = OPENING_BOOK[positionKey(state)];
  if (bookMoves && difficulty !== 'tutor') {
    const candidates = legal.filter((m) => bookMoves.includes(m.notation.replace(/[+#]/g, '')));
    if (candidates.length) return candidates[Math.floor(rng() * candidates.length)];
  }

  const cfg = SETTINGS[difficulty];
  const out = analyze(state, cfg.depth, cfg.time);
  if (!out.ranked.length) return out.best;

  // Easy levels: sometimes pick a deliberately weaker (but legal & not blundering mate) move
  // so beginners can win, by sampling within a slack window of the best score.
  if (cfg.slack > 0) {
    const bestScore = out.ranked[0].score;
    const pool = out.ranked.filter((r) => bestScore - r.score <= cfg.slack);
    let idx = 0;
    if (rng() < cfg.blunder && pool.length > 1) idx = Math.floor(rng() * pool.length);
    else if (pool.length > 1) idx = Math.floor(rng() * rng() * pool.length); // bias toward better
      return pool[Math.min(pool.length - 1, idx)].move;
  }
  return out.best;
}

export { MATE };
