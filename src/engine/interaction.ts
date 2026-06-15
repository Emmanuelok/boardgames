/**
 * The single source of truth for turning a board click into an action, shared
 * by the live game store and the interactive tutorial lessons. A legal move may
 * be a placement/removal (no `from`) or a relocation (`from`→`to`); this handles
 * selection, targets, promotion and deselection uniformly.
 */
import type { GameDefinition, MoveBase } from './types';

export type ClickResult =
  | { kind: 'play'; move: MoveBase }
  | { kind: 'select'; cell: number; targets: MoveBase[] }
  | { kind: 'promote'; from: number; to: number; options: MoveBase[] }
  | { kind: 'clear' }
  | { kind: 'none' };

export function resolveClick(
  def: GameDefinition,
  state: unknown,
  selected: number | null,
  targets: MoveBase[],
  cell: number,
): ClickResult {
  const legal = def.getLegalMoves(state, null);
  const directHere = legal.find((m) => m.from === undefined && m.to === cell);
  const isSource = (sq: number) => legal.some((m) => m.from === sq);

  if (selected === null) {
    if (directHere) return { kind: 'play', move: directHere };
    if (isSource(cell)) return { kind: 'select', cell, targets: def.getLegalMoves(state, cell) };
    return { kind: 'none' };
  }
  if (cell === selected) return { kind: 'clear' };
  if (isSource(cell)) return { kind: 'select', cell, targets: def.getLegalMoves(state, cell) };
  const matching = targets.filter((m) => m.to === cell);
  if (matching.length > 1) return { kind: 'promote', from: selected, to: cell, options: matching };
  if (matching.length === 1) return { kind: 'play', move: matching[0] };
  if (directHere) return { kind: 'play', move: directHere };
  return { kind: 'clear' };
}
