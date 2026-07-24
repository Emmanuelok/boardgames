import { describe, expect, it } from 'vitest';
import def, {
  evaluate,
  generateMoves,
  initialState,
  type DomineeringState,
} from './domineering';

const CHALLENGE =
  '{"version":1,"board":".VVHH.VVVHHVV...VVHH..VVVHHHHVVHHHH.","turn":0}';

describe('Domineering rules', () => {
  it('starts with 30 vertical anchors and exposes both covered cells', () => {
    const state = initialState();
    const moves = def.getLegalMoves(state);

    expect(moves).toHaveLength(30);
    expect(moves[0]).toMatchObject({
      id: 'V0',
      to: 0,
      affected: [0, 6],
      notation: 'Va6-a5',
    });
  });

  it('uses the clicked anchor to place exactly one oriented domino', () => {
    const before = initialState();
    const move = def.getLegalMoves(before).find((candidate) => candidate.to === 8)!;
    const after = def.applyMove(before, move);

    expect(after.board[8]).toBe(0);
    expect(after.board[14]).toBe(0);
    expect(after.turn).toBe(1);
    expect(before.board[8]).toBeNull();
    expect(def.getLegalMoves(after).every((candidate) =>
      candidate.affected.every((cell) => cell !== 8 && cell !== 14))).toBe(true);
  });

  it('places Horizontal dominoes left-to-right and rejects forged overlaps', () => {
    const horizontal: DomineeringState = {
      board: Array(36).fill(null),
      turn: 1,
    };
    const first = def.getLegalMoves(horizontal)[0];
    expect(first).toMatchObject({
      id: 'H0',
      to: 0,
      affected: [0, 1],
      notation: 'Ha6-b6',
    });

    const after = def.applyMove(horizontal, first);
    expect(after.board.slice(0, 2)).toEqual([1, 1]);
    expect(() => def.applyMove(after, first)).toThrow(/Illegal Domineering placement/);
  });
});

describe('Domineering terminal states and evaluation', () => {
  it('awards the game to the previous player when the side to move is stuck', () => {
    const board: DomineeringState['board'] = Array(36).fill(0);
    board[0] = null;
    board[6] = null;
    const state: DomineeringState = { board, turn: 1 };

    expect(def.getLegalMoves(state)).toHaveLength(0);
    expect(def.getStatus(state)).toEqual({
      kind: 'win',
      winner: 0,
      reason: 'Horizontal has no legal domino placement',
    });
    expect(evaluate(state)).toBeGreaterThan(900_000);
  });

  it('measures orientation-specific mobility from player zero’s perspective', () => {
    const board: DomineeringState['board'] = Array(36).fill(1);
    for (const cell of [0, 6, 12, 18]) board[cell] = null;
    const state: DomineeringState = { board, turn: 0 };

    expect(generateMoves(board, 0)).toHaveLength(3);
    expect(generateMoves(board, 1)).toHaveLength(0);
    expect(evaluate(state)).toBeGreaterThan(0);
  });
});

describe('Domineering intelligence and learning challenge', () => {
  it('ships an engine-valid challenge with one immediate winning placement', () => {
    const state = def.deserialize(CHALLENGE);
    const moves = def.getLegalMoves(state);
    const challenge = def.tutorial.chapters
      .flatMap((chapter) => chapter.steps)
      .find((step) => step.challenge)?.challenge;

    expect(moves.map((move) => move.notation)).toEqual(['Vc4-c3', 'Vd4-d3']);
    expect(challenge?.solution).toContain('Vc4-c3');

    const winningMove = moves.find((move) => move.notation === 'Vc4-c3')!;
    expect(def.getStatus(def.applyMove(state, winningMove))).toMatchObject({
      kind: 'win',
      winner: 0,
    });

    const alternative = moves.find((move) => move.notation === 'Vd4-d3')!;
    expect(def.getStatus(def.applyMove(state, alternative))).toEqual({ kind: 'playing' });
  });

  it('finds the tactical win deterministically and explains the strategic reason', () => {
    const state = def.deserialize(CHALLENGE);
    const first = def.chooseMove(state, 'master');
    const second = def.chooseMove(state, 'master');

    expect(first?.notation).toBe('Vc4-c3');
    expect(second?.id).toBe(first?.id);

    const hint = def.hint(state);
    expect(hint?.move.id).toBe(first?.id);
    expect(hint?.text).toMatch(/no legal domino/i);

    const after = def.applyMove(state, first!);
    const explanation = def.explainMove(state, first!, after);
    expect(explanation.band).toBe('best');
    expect(explanation.summary).toMatch(/wins/i);
    expect(explanation.insights.some((insight) => insight.tag === 'Last placement')).toBe(true);
  });

  it('keeps difficulty behavior reproducible for the same position', () => {
    const state = initialState();
    expect(def.chooseMove(state, 'easy')?.id).toBe(def.chooseMove(state, 'easy')?.id);
    expect(def.chooseMove(state, 'medium')?.id).toBe(def.chooseMove(state, 'medium')?.id);
  });
});

describe('Domineering serialization', () => {
  it('round-trips the position without sharing mutable board storage', () => {
    const start = initialState();
    const played = def.applyMove(start, def.getLegalMoves(start)[7]);
    const serialized = def.serialize(played);
    const restored = def.deserialize(serialized);
    const cloned = def.cloneState(restored);

    expect(restored).toEqual(played);
    expect(serialized).toContain('"version":1');
    cloned.board[0] = 1;
    expect(restored.board[0]).not.toBe(cloned.board[0]);
  });

  it('rejects malformed or unsupported saved positions', () => {
    expect(() => def.deserialize('{"version":2,"board":"....................................","turn":0}'))
      .toThrow(/Unsupported/);
    expect(() => def.deserialize('{"version":1,"board":"bad","turn":0}'))
      .toThrow(/Invalid Domineering board/);
    expect(() => def.deserialize('not json')).toThrow();
  });
});
