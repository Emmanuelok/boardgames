import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../engine/types';
import hexapawn, {
  createInitialState,
  type HexapawnState,
} from './hexapawn';

const norm = (notation: string) =>
  notation.replace(/[+#]/g, '').replace(/\s+/g, '').toLowerCase();

function state(
  board: HexapawnState['board'],
  turn: HexapawnState['turn'] = 0,
): HexapawnState {
  return { board, turn };
}

describe('Hexapawn rules', () => {
  it('creates the standard 3×3 opening with three legal single advances', () => {
    const initial = createInitialState();
    expect(initial).toEqual({
      board: [1, 1, 1, null, null, null, 0, 0, 0],
      turn: 0,
    });
    expect(hexapawn.getLegalMoves(initial).map((move) => move.notation)).toEqual([
      'a1-a2',
      'b1-b2',
      'c1-c2',
    ]);

    const view = hexapawn.getBoardView(initial);
    expect(view.rows).toBe(3);
    expect(view.cols).toBe(3);
    expect(view.fileLabels).toEqual(['a', 'b', 'c']);
    expect(view.rankLabels).toEqual(['3', '2', '1']);
    expect(view.cells.filter((cell) => cell.piece?.player === 0)).toHaveLength(3);
    expect(view.cells.filter((cell) => cell.piece?.player === 1)).toHaveLength(3);
  });

  it('moves one square forward only into emptiness and filters by source', () => {
    const position = state([
      null, null, null,
      null, null, null,
      0, 0, null,
    ]);
    expect(hexapawn.getLegalMoves(position, 6).map((move) => move.notation))
      .toEqual(['a1-a2']);
    expect(hexapawn.getLegalMoves(position, 7).map((move) => move.notation))
      .toEqual(['b1-b2']);
    expect(hexapawn.getLegalMoves(position, 8)).toEqual([]);

    const blocked = state([
      null, null, null,
      1, null, null,
      0, null, null,
    ]);
    expect(hexapawn.getLegalMoves(blocked, 6)).toEqual([]);
  });

  it('captures diagonally but never moves diagonally into emptiness or captures ahead', () => {
    const position = state([
      null, null, null,
      1, 1, 1,
      null, 0, null,
    ]);
    const moves = hexapawn.getLegalMoves(position, 7);
    expect(moves.map((move) => move.notation)).toEqual([
      'b1xa2',
      'b1xc2',
    ]);
    expect(moves.every((move) => move.capture)).toBe(true);
    expect(moves.every((move) => move.affected?.[0] === move.to)).toBe(true);
  });

  it('applies captures immutably and alternates the turn', () => {
    const before = state([
      null, null, null,
      1, null, null,
      null, 0, null,
    ]);
    const move = hexapawn.getLegalMoves(before, 7).find(
      (candidate) => candidate.capture,
    )!;
    const after = hexapawn.applyMove(before, move);

    expect(before.board[7]).toBe(0);
    expect(before.board[3]).toBe(1);
    expect(after).toEqual({
      board: [null, null, null, 0, null, null, null, null, null],
      turn: 1,
    });
    expect(() =>
      hexapawn.applyMove(before, {
        id: '7-5',
        from: 7,
        to: 5,
        notation: 'b1-c2',
      }),
    ).toThrow(/Illegal Hexapawn move/);
  });

  it('wins immediately upon reaching the far rank', () => {
    const before = state([
      null, null, null,
      0, null, 1,
      null, null, null,
    ]);
    const move = hexapawn.getLegalMoves(before, 3)[0];
    expect(move.notation).toBe('a2-a3');

    const after = hexapawn.applyMove(before, move);
    expect(hexapawn.getStatus(after)).toEqual({
      kind: 'win',
      winner: 0,
      reason: 'reached the far rank',
    });
    expect(hexapawn.getLegalMoves(after)).toEqual([]);
    expect(hexapawn.evaluate(after)).toBeGreaterThan(900_000);
  });

  it('awards a blockade win when the side to move has no legal move', () => {
    const blocked = state([
      null, null, null,
      null, 1, null,
      null, 0, null,
    ]);
    expect(hexapawn.getLegalMoves(blocked)).toEqual([]);
    expect(hexapawn.getStatus(blocked)).toEqual({
      kind: 'win',
      winner: 1,
      reason: 'opponent has no legal move',
    });
    expect(hexapawn.evaluate(blocked)).toBeLessThan(-900_000);
  });
});

describe('Hexapawn intelligence and teaching', () => {
  it('returns a deterministic legal move at every difficulty', () => {
    const position = createInitialState();
    const difficulties: Difficulty[] = [
      'easy',
      'medium',
      'hard',
      'master',
      'tutor',
    ];

    for (const difficulty of difficulties) {
      const first = hexapawn.chooseMove(position, difficulty);
      const second = hexapawn.chooseMove(position, difficulty);
      expect(first).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(
        hexapawn.getLegalMoves(position).some((move) => move.id === first?.id),
      ).toBe(true);
    }
  });

  it('finds and explains an immediate far-rank win', () => {
    const position = state([
      null, null, null,
      0, null, 1,
      null, null, null,
    ]);
    const move = hexapawn.chooseMove(position, 'master');
    expect(move?.notation).toBe('a2-a3');

    const hinted = hexapawn.hint(position);
    expect(hinted?.move.notation).toBe('a2-a3');
    expect(hinted?.text).toMatch(/wins immediately/i);

    const after = hexapawn.applyMove(position, move!);
    const explanation = hexapawn.explainMove(position, move!, after);
    expect(explanation.band).toBe('best');
    expect(explanation.insights.some((insight) => insight.tag === 'Far rank reached'))
      .toBe(true);
  });

  it('keeps every authored tutorial challenge legal and engine-valid', () => {
    const challenges = hexapawn.tutorial.chapters
      .flatMap((chapter) => chapter.steps)
      .filter((step) => step.challenge);
    expect(challenges.length).toBeGreaterThanOrEqual(2);

    for (const step of challenges) {
      const position = step.setup
        ? hexapawn.deserialize(step.setup)
        : hexapawn.createInitialState();
      const legal = hexapawn.getLegalMoves(position);
      const solutions = step.challenge!.solution.map(norm);
      const matching = legal.filter((move) =>
        solutions.includes(norm(move.notation)),
      );
      expect(
        matching.length,
        `${step.title}: ${step.challenge!.solution.join(', ')}`,
      ).toBeGreaterThan(0);
      expect(
        matching.some((move) => {
          const result = hexapawn.getStatus(
            hexapawn.applyMove(position, move),
          );
          return result.kind === 'win' && result.winner === position.turn;
        }),
      ).toBe(true);
    }
  });
});

describe('Hexapawn persistence', () => {
  it('clones and serializes without sharing board storage', () => {
    const original = state([
      null, 1, null,
      0, null, null,
      null, null, null,
    ], 1);
    const clone = hexapawn.cloneState(original);
    const restored = hexapawn.deserialize(hexapawn.serialize(original));

    expect(clone).toEqual(original);
    expect(clone.board).not.toBe(original.board);
    expect(restored).toEqual(original);
    expect(restored.board).not.toBe(original.board);

    clone.board[0] = 0;
    expect(original.board[0]).toBeNull();
  });

  it('rejects malformed serialized positions', () => {
    expect(() => hexapawn.deserialize('{}')).toThrow(/Invalid Hexapawn state/);
    expect(() =>
      hexapawn.deserialize('{"board":[0,1],"turn":0}'),
    ).toThrow(/Invalid Hexapawn state/);
    expect(() =>
      hexapawn.deserialize(
        '{"board":[1,1,1,null,null,null,0,0,"x"],"turn":0}',
      ),
    ).toThrow(/Invalid Hexapawn state/);
    expect(() =>
      hexapawn.deserialize(
        '{"board":[1,1,1,null,null,null,0,0,0],"turn":2}',
      ),
    ).toThrow(/Invalid Hexapawn state/);
  });
});
