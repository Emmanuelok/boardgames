import { describe, it, expect } from 'vitest';
import { GAMES, getGame } from '../engine/registry';
import { CHESS_PUZZLES } from './chessPuzzles';
import { ALL_PUZZLES } from './allPuzzles';

// A move matches a solution when its notation agrees once check/mate marks and
// whitespace are ignored (the same comparison the Puzzle/Trainer UI uses).
const norm = (s: string) => s.replace(/[+#]/g, '').replace(/\s+/g, '').toLowerCase();

describe('puzzle dataset stays solvable', () => {
  it('every chess puzzle has a legal position and a legal first move', () => {
    const chess = getGame('chess')!;
    for (const p of CHESS_PUZZLES) {
      const state = chess.deserialize(p.fen);
      const legal = chess.getLegalMoves(state, null);
      expect(legal.length, `${p.id}: FEN has no legal moves`).toBeGreaterThan(0);
      const sol = norm(p.solution[0]);
      expect(legal.some((m) => norm(m.notation) === sol), `${p.id}: solution ${p.solution[0]} is not a legal move`).toBe(true);
    }
  });

  it('every interactive course challenge has a legal solution move', () => {
    for (const def of GAMES) {
      for (const ch of def.tutorial.chapters) {
        for (const step of ch.steps) {
          if (!step.challenge) continue;
          const state = step.setup ? def.deserialize(step.setup) : def.createInitialState();
          const legal = def.getLegalMoves(state, null);
          const sols = step.challenge.solution.map(norm);
          expect(
            legal.some((m) => sols.includes(norm(m.notation))),
            `${def.id} "${step.title}": no legal move matches ${JSON.stringify(step.challenge.solution)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('builds a non-trivial, well-formed pool', () => {
    expect(ALL_PUZZLES.length).toBeGreaterThan(20);
    for (const p of ALL_PUZZLES) {
      expect(p.id).toBeTruthy();
      expect(p.solution.length).toBeGreaterThan(0);
      expect(getGame(p.gameId), `puzzle references unknown game ${p.gameId}`).toBeTruthy();
    }
  });
});
