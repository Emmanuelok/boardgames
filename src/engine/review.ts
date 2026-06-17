/**
 * Shared move-grading for the bespoke games so they can feed the standard
 * post-game GameReview (accuracy, eval graph, breakdown). A move is graded by
 * comparing the position it produced to the one the engine's best move would
 * have produced, both from the mover's point of view — the same "loss" idea the
 * full tutor uses, distilled to just the band + eval the review needs.
 */
import { searchBestMove, type SearchGame } from './ai';
import { gradeByLoss, toMover } from './grade';
import type { MoveExplanation } from './types';

export function gradeMoveBySearch<S, M extends { id: string }>(
  before: S, move: M, after: S,
  game: SearchGame<S, M>,
  opts: { depth: number; bigThreshold: number; lossScale?: number },
): MoveExplanation {
  const mover = game.getTurn(before);
  const res = searchBestMove(before, game, opts.depth);
  const evalAfter = game.evaluate(after);
  const best = res.ranked[0]?.score ?? evalAfter;
  const played = res.ranked.find((r) => r.move.id === move.id)?.score ?? evalAfter;
  const loss = Math.max(0, toMover(best, mover) - toMover(played, mover)) * (opts.lossScale ?? 1);
  const winningBig = Math.abs(toMover(evalAfter, mover)) > opts.bigThreshold;
  return { summary: '', band: gradeByLoss(loss, winningBig), evalBefore: game.evaluate(before), evalAfter, insights: [], principles: [] };
}
