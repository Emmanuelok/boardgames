/**
 * Generic adversarial search shared by the lighter games (Tic-Tac-Toe,
 * Connect Four, Reversi, Gomoku). Chess ships its own tuned engine.
 *
 * Evaluation convention everywhere in the app: a positive score favours
 * player 0. `searchBestMove` maximises for player 0 and minimises for
 * player 1, using alpha-beta pruning, and also returns every root move
 * scored so the tutor can rank candidates and grade what was actually played.
 */
import type { Player } from './types';

export interface SearchGame<S, M> {
  getLegalMoves(s: S): M[];
  applyMove(s: S, m: M): S;
  getTurn(s: S): Player;
  isTerminal(s: S): boolean;
  /** Static evaluation; positive favours player 0. Large magnitudes for wins. */
  evaluate(s: S): number;
  /** Optional move ordering hint (higher tried first) for better pruning. */
  order?(s: S, m: M): number;
}

const WIN = 1_000_000;

/** Deterministic small PRNG so "easy" AI is reproducible within a turn. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function negamaxAB<S, M>(
  state: S,
  game: SearchGame<S, M>,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0 || game.isTerminal(state)) return game.evaluate(state);
  let moves = game.getLegalMoves(state);
  if (moves.length === 0) return game.evaluate(state);
  if (game.order) {
    moves = [...moves].sort((a, b) => game.order!(state, b) - game.order!(state, a));
  }
  const turn = game.getTurn(state);

  if (turn === 0) {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, negamaxAB(game.applyMove(state, m), game, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      best = Math.min(best, negamaxAB(game.applyMove(state, m), game, depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

export interface ScoredMove<M> {
  move: M;
  score: number;
}

export interface SearchResult<M> {
  move: M | null;
  score: number;
  /** Every root move with its evaluation, sorted best-first for the mover. */
  ranked: ScoredMove<M>[];
}

/**
 * Search to `depth` plies and return the best move for the side to move,
 * plus all root moves ranked. `randomness` (0..1) lets easy levels pick a
 * near-best move instead of always the optimum.
 */
export function searchBestMove<S, M>(
  state: S,
  game: SearchGame<S, M>,
  depth: number,
  opts: { randomness?: number; rng?: () => number } = {},
): SearchResult<M> {
  const moves = game.getLegalMoves(state);
  if (moves.length === 0) return { move: null, score: game.evaluate(state), ranked: [] };

  const turn = game.getTurn(state);
  const scored: ScoredMove<M>[] = moves.map((move) => ({
    move,
    score: negamaxAB(game.applyMove(state, move), game, depth - 1, -Infinity, Infinity),
  }));

  // Sort best-first from the mover's perspective.
  scored.sort((a, b) => (turn === 0 ? b.score - a.score : a.score - b.score));

  const rng = opts.rng ?? Math.random;
  const randomness = opts.randomness ?? 0;
  let choice = scored[0];

  if (randomness > 0 && scored.length > 1) {
    // Build a pool of moves within a slack window of the best, weighted by how
    // close they are, then sample. Higher randomness => wider, flatter pool.
    const bestScore = scored[0].score;
    const slack = 40 + randomness * 600;
    const pool = scored.filter((s) => Math.abs(s.score - bestScore) <= slack);
    const idx = Math.min(pool.length - 1, Math.floor(rng() * Math.max(1, pool.length * randomness * 1.3)));
    choice = pool[Math.max(0, idx)] ?? scored[0];
  }

  return { move: choice.move, score: choice.score, ranked: scored };
}

export { WIN };
