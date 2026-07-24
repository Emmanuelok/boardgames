import { describe, expect, it } from 'vitest';
import def, {
  CONNECTIONS,
  applyMove,
  createInitialState,
  evaluate,
  legalMoves,
  outcomeOf,
  positionKey,
  rawLegalMoves,
  type MuTorereState,
} from './mutorere';

const state = (
  board: MuTorereState['board'],
  turn: MuTorereState['turn'],
  ply = 0,
  history?: string[],
): MuTorereState => ({
  board,
  turn,
  ply,
  history: history ?? [positionKey(board, turn)],
});

describe('Mū Tōrere rules', () => {
  it('creates the canonical four-versus-four ring with an empty centre', () => {
    const initial = createInitialState();
    expect(initial.board).toEqual([0, 0, 0, 1, null, 0, 1, 1, 1]);
    expect(initial.turn).toBe(0);
    expect(initial.history).toEqual([positionKey(initial.board, 0)]);
    expect(legalMoves(initial).map((move) => move.notation)).toEqual([
      'NW–Pūtahi',
      'E–Pūtahi',
    ]);
  });

  it('draws the eight ring links and all eight centre spokes', () => {
    expect(CONNECTIONS).toHaveLength(16);
    expect(new Set(CONNECTIONS.map(([a, b]) => `${a}-${b}`)).size).toBe(16);
    for (const outer of [0, 1, 2, 3, 5, 6, 7, 8]) {
      expect(CONNECTIONS.some(([a, b]) => (a === outer && b === 4) || (a === 4 && b === outer))).toBe(true);
    }
  });

  it('allows ring-to-ring movement only to an adjacent vacancy', () => {
    const position = state([0, 0, null, 1, 1, 0, 1, 0, 1], 0);
    expect(rawLegalMoves(position.board, 0).map((move) => move.notation)).toContain('N–NE');
    expect(rawLegalMoves(position.board, 0).some((move) => move.from === 7 && move.to === 2)).toBe(false);
  });

  it('enforces opponent contact before a ring stone can enter the centre', () => {
    const initial = createInitialState();
    const moves = rawLegalMoves(initial.board, 0);
    expect(moves.some((move) => move.from === 0 && move.to === 4)).toBe(true);
    expect(moves.some((move) => move.from === 5 && move.to === 4)).toBe(true);
    expect(moves.some((move) => move.from === 1 && move.to === 4)).toBe(false);
    expect(moves.some((move) => move.from === 2 && move.to === 4)).toBe(false);
  });

  it('lets a centre stone move to the empty outer point', () => {
    const position = state([0, 0, null, 1, 0, 1, 1, 0, 1], 0);
    const centreMoves = legalMoves(position, 4);
    expect(centreMoves).toHaveLength(1);
    expect(centreMoves[0]).toMatchObject({ from: 4, to: 2, notation: 'Pūtahi–NE' });
  });

  it('awards a win when the next player has no move', () => {
    const before = state([0, 0, null, 1, 0, 1, 1, 0, 1], 0, 18);
    const winningMove = legalMoves(before).find((move) => move.notation === 'N–NE');
    expect(winningMove).toBeDefined();
    const after = applyMove(before, winningMove!);
    expect(outcomeOf(after)).toBe(0);
    expect(def.getStatus(after)).toEqual({
      kind: 'win',
      winner: 0,
      reason: 'the opponent has no legal move',
    });
    expect(evaluate(after)).toBeGreaterThan(900_000);
  });

  it('declares the current position drawn on its third occurrence', () => {
    const initial = createInitialState();
    const key = positionKey(initial.board, initial.turn);
    const repeated = { ...initial, ply: 20, history: [key, 'other:1', key, 'other:0', key] };
    expect(outcomeOf(repeated)).toBe('draw');
    expect(def.getStatus(repeated)).toEqual({
      kind: 'draw',
      reason: 'the position repeated three times',
    });
    expect(legalMoves(repeated)).toEqual([]);
  });

  it('uses the ply cap as a deterministic final draw safeguard', () => {
    const initial = createInitialState();
    const capped = { ...initial, ply: 160 };
    expect(def.getStatus(capped)).toEqual({
      kind: 'draw',
      reason: 'the safety move limit was reached',
    });
    expect(def.chooseMove(capped, 'master')).toBeNull();
  });
});

describe('Mū Tōrere intelligence and learning', () => {
  it('uses the tablebase to take an immediate blockade at Master difficulty', () => {
    const position = state([0, 0, null, 1, 0, 1, 1, 0, 1], 0, 18);
    const move = def.chooseMove(position, 'master');
    expect(move?.notation).toBe('N–NE');
    expect(def.getStatus(applyMove(position, move!)).kind).toBe('win');
  });

  it.each(['tutor', 'easy', 'medium', 'hard', 'master'] as const)(
    'returns a deterministic legal move at %s difficulty',
    (difficulty) => {
      const position = createInitialState();
      const first = def.chooseMove(position, difficulty);
      const second = def.chooseMove(position, difficulty);
      expect(first).not.toBeNull();
      expect(first?.id).toBe(second?.id);
      expect(legalMoves(position).some((move) => move.id === first?.id)).toBe(true);
    },
  );

  it('holds the balanced opening to a repetition draw in Master self-play', () => {
    let position = createInitialState();
    while (def.getStatus(position).kind === 'playing' && position.ply < 160) {
      const move = def.chooseMove(position, 'master');
      expect(move).not.toBeNull();
      position = applyMove(position, move!);
    }
    expect(def.getStatus(position)).toEqual({
      kind: 'draw',
      reason: 'the position repeated three times',
    });
  });

  it('provides an engine-valid tutorial challenge and explanatory tutor output', () => {
    const challenge = def.tutorial.chapters
      .flatMap((chapter) => chapter.steps)
      .find((step) => step.challenge);
    expect(challenge?.setup).toBeDefined();
    const position = def.deserialize(challenge!.setup!);
    const solution = legalMoves(position).find(
      (move) => challenge!.challenge!.solution.includes(move.notation),
    );
    expect(solution).toBeDefined();
    const after = applyMove(position, solution!);
    expect(def.getStatus(after)).toMatchObject({ kind: 'win', winner: position.turn });
    const explanation = def.explainMove(position, solution!, after);
    expect(explanation.band).toBe('best');
    expect(explanation.insights.some((insight) => insight.tag === 'Complete blockade')).toBe(true);
    expect(def.hint(position)?.move.id).toBe(solution!.id);
  });

  it('round-trips a state without sharing mutable board or history arrays', () => {
    const initial = createInitialState();
    const move = legalMoves(initial)[0];
    const played = applyMove(initial, move);
    const restored = def.deserialize(def.serialize(played));
    expect(restored).toEqual(played);
    restored.board[1] = null;
    restored.history.push('mutated');
    expect(played.board[1]).not.toBeNull();
    expect(played.history).not.toContain('mutated');
  });

  it('rejects malformed serialized positions', () => {
    expect(() => def.deserialize('{"board":[0,1],"turn":0}')).toThrow('Invalid Mū Tōrere position');
    expect(() => def.deserialize('{"board":[0,0,0,0,null,1,1,1,7],"turn":0}')).toThrow(
      'Invalid Mū Tōrere position',
    );
    expect(() => def.deserialize('{"board":[0,0,0,0,null,0,1,1,1],"turn":0}')).toThrow(
      'Invalid Mū Tōrere position',
    );
  });
});
