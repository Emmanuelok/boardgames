/**
 * Move grading shared by the tutor across games.
 *
 * The honest way to grade a move is to compare the position it produced with
 * the position the *best* move would have produced — both measured from the
 * mover's point of view. That difference is the "loss" (centipawn loss in
 * chess parlance). Small loss = a fine move; large loss = a blunder.
 */
import type { EvalBand, Player } from './types';

/** Flip an absolute eval (+favours player 0) into the mover's perspective. */
export function toMover(score: number, mover: Player): number {
  return mover === 0 ? score : -score;
}

export function gradeByLoss(loss: number, winningBig: boolean): EvalBand {
  if (loss <= 4) return winningBig ? 'great' : 'best';
  if (loss <= 20) return 'good';
  if (loss <= 55) return 'solid';
  if (loss <= 120) return 'inaccuracy';
  if (loss <= 320) return 'mistake';
  return 'blunder';
}

export const BAND_META: Record<EvalBand, { label: string; symbol: string; color: string; tone: 'good' | 'bad' | 'info' }> = {
  brilliant: { label: 'Brilliant', symbol: '!!', color: '#22d3ee', tone: 'good' },
  great: { label: 'Great', symbol: '!', color: '#34d399', tone: 'good' },
  best: { label: 'Best', symbol: '★', color: '#4ade80', tone: 'good' },
  good: { label: 'Good', symbol: '✓', color: '#86efac', tone: 'good' },
  book: { label: 'Book', symbol: '📖', color: '#a3a3a3', tone: 'info' },
  solid: { label: 'Solid', symbol: '=', color: '#cbd5e1', tone: 'info' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#fbbf24', tone: 'bad' },
  mistake: { label: 'Mistake', symbol: '?', color: '#fb923c', tone: 'bad' },
  blunder: { label: 'Blunder', symbol: '??', color: '#f87171', tone: 'bad' },
};
