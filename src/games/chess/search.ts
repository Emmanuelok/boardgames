/**
 * The chess brain: iterative-deepening principal-variation search (negamax with
 * alpha-beta) over a transposition table keyed by the position's Zobrist hash,
 * with a quiescence search, MVV-LVA + killer + history move ordering, a compact
 * opening book and difficulty tuning. Exposes:
 *   - `bestMove` : choose a move for the AI at a given difficulty.
 *   - `analyze`  : score every root move (used by the tutor and the Hint button).
 */
import { Position as Pos, type ChessMove as CMove, type ChessState as CState, WHITE } from './engine';
import { evaluatePosition, MATE, MATERIAL } from './evaluate';
import { OPENING_BOOK, positionKey } from './book';
import type { Difficulty } from '../../engine/types';

const INF = 1e9;
const EXACT = 0, LOWER = 1, UPPER = 2;
interface TTE { depth: number; score: number; flag: number; moveId: string; }

let tt = new Map<bigint, TTE>();
let killers: string[][] = [];
let history: Record<string, number> = {};
let nodes = 0;
let deadline = 0;
let stopped = false;

function evalSTM(pos: Pos): number {
  const e = evaluatePosition(pos);
  return pos.turn === WHITE ? e : -e;
}

function scoreMove(m: CMove, ply: number, ttMove?: string): number {
  if (ttMove && m.id === ttMove) return 2e7;
  let s = 0;
  if (m.capture) {
    const victim = m.captured ? MATERIAL[Math.abs(m.captured)] : 100;
    s += 1e6 + victim * 16 - (MATERIAL[Math.abs(m.piece)] || 1);
  }
  if (m.promo) s += 9e5 + MATERIAL[m.promo];
  const k = killers[ply];
  if (k && (k[0] === m.id || k[1] === m.id)) s += 8e5;
  s += history[m.id] || 0;
  return s;
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
  if ((++nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return alpha;

  const alphaOrig = alpha, betaOrig = beta;
  const key = pos.hash;
  const tte = tt.get(key);
  if (tte && tte.depth >= depth) {
    let s = tte.score;
    if (s > MATE - 1000) s -= ply; else if (s < -MATE + 1000) s += ply;
    if (tte.flag === EXACT) return s;
    if (tte.flag === LOWER && s > alpha) alpha = s;
    else if (tte.flag === UPPER && s < beta) beta = s;
    if (alpha >= beta) return s;
  }

  if (depth <= 0) return quiesce(pos, alpha, beta);

  const inCheck = pos.inCheck(pos.turn);
  const moves = pos.legalMoves();
  if (moves.length === 0) return inCheck ? -MATE + ply : 0;
  if (pos.half >= 100) return 0;

  // Null-move pruning: if giving the opponent a free move still fails high, prune.
  if (depth >= 3 && !inCheck && beta < MATE - 1000 && pos.hasNonPawnMaterial()) {
    pos.makeNull();
    const R = depth > 6 ? 3 : 2;
    const nullScore = -negamax(pos, depth - 1 - R, -beta, -beta + 1, ply + 1);
    pos.unmakeNull();
    if (stopped) return alpha;
    if (nullScore >= beta) return beta;
  }

  const ttMove = tte?.moveId;
  moves.sort((a, b) => scoreMove(b, ply, ttMove) - scoreMove(a, ply, ttMove));

  let best = -INF;
  let bestId = moves[0].id;
  let first = true;
  let moveCount = 0;
  for (const m of moves) {
    moveCount++;
    pos.make(m);
    const gives = pos.inCheck(pos.turn); // does this move give check?
    let score: number;
    if (first) {
      score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    } else {
      // Late-move reduction for quiet, non-checking moves searched late.
      let red = 0;
      if (depth >= 3 && moveCount > 3 && !m.capture && !m.promo && !gives) red = moveCount > 8 ? 2 : 1;
      score = -negamax(pos, depth - 1 - red, -alpha - 1, -alpha, ply + 1);
      if (red > 0 && score > alpha) score = -negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1);
      if (score > alpha && score < beta) score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    }
    pos.unmake();
    first = false;
    if (stopped) return best > -INF ? best : alpha;
    if (score > best) { best = score; bestId = m.id; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!m.capture) { addKiller(m.id, ply); history[m.id] = (history[m.id] || 0) + depth * depth; }
      break;
    }
  }

  let store = best;
  if (store > MATE - 1000) store += ply; else if (store < -MATE + 1000) store -= ply;
  const flag = best <= alphaOrig ? UPPER : best >= betaOrig ? LOWER : EXACT;
  if (tt.size < 1_200_000) tt.set(key, { depth, score: store, flag, moveId: bestId });
  return best;
}

export interface Ranked { move: CMove; score: number; }
export interface SearchOut { best: CMove | null; score: number; ranked: Ranked[]; depth: number; nodes: number; pv: string[]; }

const rankOf = (ranked: Ranked[], m: CMove) => ranked.find((r) => r.move.id === m.id)?.score ?? 0;

/** Recover the principal variation as SAN: seed with the chosen root move (its
 *  child positions were searched and stored), then follow the transposition
 *  table's best-move chain. Bounded and side-effect-free (every make is unmade). */
function extractPV(state: CState, best: CMove, maxLen: number): string[] {
  const pos = new Pos(state);
  const sans = [pos.toSAN(best)];
  pos.make(best);
  let made = 1;
  for (let i = 1; i < maxLen; i++) {
    const e = tt.get(pos.hash);
    const legal = pos.legalMoves();
    if (!e || !e.moveId || legal.length === 0) break;
    const mv = legal.find((m) => m.id === e.moveId);
    if (!mv) break;
    sans.push(pos.toSAN(mv));
    pos.make(mv);
    made++;
  }
  for (let i = 0; i < made; i++) pos.unmake();
  return sans;
}

/** Iterative-deepening full-window search of every root move (comparable scores). */
export function analyze(state: CState, maxDepth: number, timeMs = 1500): SearchOut {
  const pos = new Pos(state);
  const roots = pos.legalMoves();
  for (const m of roots) m.notation = pos.toSAN(m);
  if (roots.length === 0) return { best: null, score: evalSTM(pos), ranked: [], depth: 0, nodes: 0, pv: [] };

  tt = new Map();
  killers = [];
  history = {};
  nodes = 0;
  stopped = false;
  deadline = Date.now() + timeMs;
  let ranked: Ranked[] = roots.map((m) => ({ move: m, score: 0 }));
  let reached = 0;

  for (let d = 1; d <= maxDepth; d++) {
    const local: Ranked[] = [];
    const ordered = [...roots].sort((a, b) => rankOf(ranked, b) - rankOf(ranked, a));
    let timedOut = false;
    for (const m of ordered) {
      pos.make(m);
      const sc = -negamax(pos, d - 1, -INF, INF, 1);
      pos.unmake();
      local.push({ move: m, score: sc });
      if (stopped || Date.now() > deadline) { timedOut = true; break; }
    }
    if (local.length === roots.length) {
      local.sort((a, b) => b.score - a.score);
      ranked = local;
      reached = d;
    }
    if (timedOut || stopped || Date.now() > deadline) break;
  }
  const pv = extractPV(state, ranked[0].move, 6);
  return { best: ranked[0].move, score: ranked[0].score, ranked, depth: reached, nodes, pv };
}

/** Properly alpha-beta-pruned root search (for the AI's actual move) — goes far
 *  deeper than `analyze` because it prunes across root moves. */
export function searchBest(state: CState, maxDepth: number, timeMs: number): { move: CMove | null; score: number; depth: number; nodes: number } {
  const pos = new Pos(state);
  const roots = pos.legalMoves();
  for (const m of roots) m.notation = pos.toSAN(m);
  if (roots.length === 0) return { move: null, score: evalSTM(pos), depth: 0, nodes: 0 };

  tt = new Map();
  killers = [];
  history = {};
  nodes = 0;
  stopped = false;
  deadline = Date.now() + timeMs;
  let bestId = roots[0].id;
  let score = 0;
  let reached = 0;

  for (let d = 1; d <= maxDepth; d++) {
    const sc = negamax(pos, d, -INF, INF, 0);
    if (!stopped) { score = sc; bestId = tt.get(pos.hash)?.moveId ?? bestId; reached = d; }
    if (stopped || Date.now() > deadline) break;
  }
  return { move: roots.find((m) => m.id === bestId) ?? roots[0], score, depth: reached, nodes };
}

const SETTINGS: Record<Difficulty, { depth: number; time: number; slack: number; blunder: number }> = {
  tutor: { depth: 5, time: 800, slack: 0, blunder: 0 },
  easy: { depth: 2, time: 300, slack: 220, blunder: 0.35 },
  medium: { depth: 4, time: 700, slack: 90, blunder: 0.12 },
  hard: { depth: 8, time: 2200, slack: 0, blunder: 0 },
  master: { depth: 12, time: 4000, slack: 0, blunder: 0 },
};

/** Choose the AI's move, with opening-book variety and difficulty flavour. */
export function bestMove(state: CState, difficulty: Difficulty, rng: () => number = Math.random): CMove | null {
  const pos = new Pos(state);
  const legal = pos.legalMoves();
  for (const m of legal) m.notation = pos.toSAN(m);
  if (legal.length === 0) return null;

  const bookMoves = OPENING_BOOK[positionKey(state)];
  if (bookMoves && difficulty !== 'tutor') {
    const candidates = legal.filter((m) => bookMoves.includes(m.notation.replace(/[+#]/g, '')));
    if (candidates.length) return candidates[Math.floor(rng() * candidates.length)];
  }

  const cfg = SETTINGS[difficulty];

  // Stronger levels: a deep, properly-pruned root search.
  if (cfg.slack === 0) return searchBest(state, cfg.depth, cfg.time).move;

  // Gentler levels: rank moves (shallow) and sample within a slack window so
  // beginners can win and the play feels human.
  const out = analyze(state, cfg.depth, cfg.time);
  if (!out.ranked.length) return out.best;
  const bestScore = out.ranked[0].score;
  const pool = out.ranked.filter((r) => bestScore - r.score <= cfg.slack);
  let idx = 0;
  if (rng() < cfg.blunder && pool.length > 1) idx = Math.floor(rng() * pool.length);
  else if (pool.length > 1) idx = Math.floor(rng() * rng() * pool.length);
  return pool[Math.min(pool.length - 1, idx)].move;
}

export { MATE };
