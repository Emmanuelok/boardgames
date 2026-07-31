import { describe, expect, it } from 'vitest';
import {
  MIND_GAME_LEVELS,
  TILE_KINDS,
  analyzeMoves,
  applyMove,
  createDailyGame,
  createGame,
  dailySeed,
  exportReplay,
  forecastMove,
  getMatchedPositions,
  getValidMoves,
  isAdjacent,
  isValidMove,
  replayGame,
  replayTurns,
  seedFromString,
  stateFingerprint,
  type MindGameState,
  type Position,
  type Swap,
  type TilePower,
} from './engine';

const everyPosition = (rows = 7, columns = 7): Position[] => (
  Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns),
    column: index % columns,
  }))
);

const boardSignature = (state: MindGameState): string => state.board.map((row) => row.map((cell) => (
  `${cell.tile?.kind}:${cell.tile?.power}:${cell.marked ? 1 : 0}`
)).join('|')).join('/');

function assertStablePlayableBoard(state: MindGameState): void {
  expect(state.board).toHaveLength(state.config.rows);
  expect(state.board.every((row) => row.length === state.config.columns)).toBe(true);
  expect(state.board.flat().every((cell) => cell.tile !== null)).toBe(true);
  expect(new Set(state.board.flat().map((cell) => cell.tile?.id)).size).toBe(
    state.config.rows * state.config.columns,
  );
  expect(getMatchedPositions(state.board)).toHaveLength(0);
  if (state.status === 'playing') expect(getValidMoves(state).length).toBeGreaterThan(0);
}

function postSwapOrigin(position: Position, swap: Swap): Position {
  if (position.row === swap.from.row && position.column === swap.from.column) return swap.to;
  if (position.row === swap.to.row && position.column === swap.to.column) return swap.from;
  return position;
}

function withPower(state: MindGameState, position: Position, power: TilePower): MindGameState {
  const board = state.board.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (rowIndex !== position.row || columnIndex !== position.column || !cell.tile) return cell;
    return { ...cell, tile: { ...cell.tile, power } };
  }));
  return { ...state, board };
}

function findSpecialScenario(): { state: MindGameState; swap: Swap } {
  for (let seed = 1; seed <= 96; seed += 1) {
    const state = createGame({ seed });
    const analysis = analyzeMoves(state).find((candidate) => candidate.specialsCreated > 0);
    if (analysis) return { state, swap: analysis.swap };
  }
  throw new Error('Expected a deterministic special-creation scenario.');
}

function findDeepCascadeScenario(): { seed: number; swap: Swap; depth: number } {
  for (let seed = 1; seed <= 96; seed += 1) {
    const state = createGame({ seed });
    const analysis = analyzeMoves(state).find((candidate) => candidate.cascadeDepth >= 2);
    if (analysis) return { seed, swap: analysis.swap, depth: analysis.cascadeDepth };
  }
  throw new Error('Expected a deterministic cascade scenario.');
}

describe('Mind Cascade deterministic engine', () => {
  it('creates full seeded boards with no initial matches and at least one legal swap', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createGame({ seed });
      assertStablePlayableBoard(state);
      expect(state.board).toHaveLength(7);
      expect(state.board[0]).toHaveLength(7);
      expect(state.movesRemaining).toBe(state.config.moves);
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.board)).toBe(true);
      expect(Object.isFrozen(state.board[0][0].tile)).toBe(true);
    }
  });

  it('reproduces a board and complete turn stream from the same seed', () => {
    let first = createGame({
      seed: 'shared-study-session',
      config: { objectives: [{ type: 'collect', kind: 'slate', target: 999 }], moves: 12 },
    });
    let second = createGame({
      seed: 'shared-study-session',
      config: { objectives: [{ type: 'collect', kind: 'slate', target: 999 }], moves: 12 },
    });
    expect(first).toEqual(second);

    for (let turn = 0; turn < 8; turn += 1) {
      const swap = analyzeMoves(first, 1)[0].swap;
      first = applyMove(first, swap);
      second = applyMove(second, swap);
      expect(stateFingerprint(first)).toBe(stateFingerprint(second));
      expect(first.history[turn]).toEqual(second.history[turn]);
    }
    expect(first).toEqual(second);
  });

  it('uses the seed to create meaningfully different puzzles', () => {
    const first = createGame({ seed: 101 });
    const second = createGame({ seed: 102 });
    expect(boardSignature(first)).not.toBe(boardSignature(second));
    expect(seedFromString('alpha')).toBe(seedFromString('alpha'));
    expect(seedFromString('alpha')).not.toBe(seedFromString('beta'));
  });

  it('accepts only orthogonally adjacent match-producing swaps', () => {
    const state = createGame({ seed: 81 });
    const legal = getValidMoves(state)[0];
    expect(isAdjacent(legal.from, legal.to)).toBe(true);
    expect(isValidMove(state, legal)).toBe(true);
    expect(isValidMove(state, { from: legal.to, to: legal.from })).toBe(true);
    expect(isValidMove(state, { from: { row: 0, column: 0 }, to: { row: 1, column: 1 } })).toBe(false);
    expect(isValidMove(state, { from: { row: -1, column: 0 }, to: { row: 0, column: 0 } })).toBe(false);
  });

  it('returns the same reference for invalid moves and never mutates a prior state', () => {
    const state = createGame({ seed: 22 });
    const snapshot = JSON.stringify(state);
    const invalid = applyMove(state, { from: { row: 0, column: 0 }, to: { row: 2, column: 0 } });
    expect(invalid).toBe(state);

    const next = applyMove(state, getValidMoves(state)[0]);
    expect(next).not.toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.turn).toBe(0);
    expect(next.turn).toBe(1);
    expect(next.movesRemaining).toBe(state.movesRemaining - 1);
    expect(next.history).toHaveLength(1);
    expect(next.history[0].beforeHash).toBe(stateFingerprint(state));
    expect(next.history[0].afterHash).toBe(stateFingerprint(next));
    assertStablePlayableBoard(next);
  });

  it('maintains board invariants through a long deterministic session', () => {
    let state = createGame({
      seed: 7_777,
      config: {
        moves: 30,
        objectives: [{ type: 'collect', kind: 'ember', target: 999 }],
      },
    });
    for (let turn = 0; turn < 20; turn += 1) {
      const best = analyzeMoves(state, 1)[0];
      expect(best).toBeDefined();
      state = applyMove(state, best.swap);
      assertStablePlayableBoard(state);
      expect(state.turn).toBe(turn + 1);
      expect(state.movesRemaining).toBe(29 - turn);
    }
  });

  it('resolves seeded cascades and records each depth deterministically', () => {
    const scenario = findDeepCascadeScenario();
    const first = createGame({ seed: scenario.seed });
    const second = createGame({ seed: scenario.seed });
    const firstResult = applyMove(first, scenario.swap);
    const secondResult = applyMove(second, scenario.swap);
    const cascades = firstResult.history[0].cascades;
    expect(cascades.length).toBe(scenario.depth);
    expect(cascades.map((cascade) => cascade.depth)).toEqual(
      Array.from({ length: scenario.depth }, (_, index) => index + 1),
    );
    expect(cascades.every((cascade) => cascade.cleared.length >= 3)).toBe(true);
    expect(firstResult).toEqual(secondResult);
  });

  it('creates strategic Mirror or Orbit tiles from advanced formations', () => {
    const { state, swap } = findSpecialScenario();
    const next = applyMove(state, swap);
    const created = next.history[0].cascades.flatMap((cascade) => cascade.createdSpecials);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((special) => special.power === 'mirror' || special.power === 'orbit')).toBe(true);
    const powersOnBoard = next.board.flat().map((cell) => cell.tile?.power);
    expect(powersOnBoard.some((power) => power === 'mirror' || power === 'orbit')).toBe(true);
  });

  it('activates Mirror tiles through 180-degree board symmetry', () => {
    const state = createGame({ seed: 303 });
    const swap = getValidMoves(state)[0];
    const plainResult = applyMove(state, swap);
    const matched = plainResult.history[0].cascades[0].matched;
    const activationPosition = matched.find((position) => {
      const counterpart = {
        row: state.config.rows - 1 - position.row,
        column: state.config.columns - 1 - position.column,
      };
      return !matched.some((candidate) => (
        candidate.row === counterpart.row && candidate.column === counterpart.column
      ));
    });
    expect(activationPosition).toBeDefined();
    const origin = postSwapOrigin(activationPosition!, swap);
    const powered = withPower(state, origin, 'mirror');
    const result = applyMove(powered, swap);
    const activation = result.history[0].cascades[0].activatedSpecials.find((special) => special.power === 'mirror');
    const expected = {
      row: state.config.rows - 1 - activationPosition!.row,
      column: state.config.columns - 1 - activationPosition!.column,
    };
    expect(activation?.position).toEqual(activationPosition);
    expect(activation?.affected).toContainEqual(expected);
    expect(result.history[0].cascades[0].cleared).toContainEqual(expected);
  });

  it('activates Orbit tiles exactly two orthogonal steps away', () => {
    const state = createGame({ seed: 509 });
    const swap = getValidMoves(state)[0];
    const plainResult = applyMove(state, swap);
    const matched = plainResult.history[0].cascades[0].matched;
    const activationPosition = matched.find((position) => (
      position.row >= 2
      && position.column >= 2
      && position.row < state.config.rows - 2
      && position.column < state.config.columns - 2
    )) ?? matched[0];
    const origin = postSwapOrigin(activationPosition, swap);
    const powered = withPower(state, origin, 'orbit');
    const result = applyMove(powered, swap);
    const activation = result.history[0].cascades[0].activatedSpecials.find((special) => special.power === 'orbit');
    expect(activation?.position).toEqual(activationPosition);
    expect(activation?.affected.every((position) => (
      Math.abs(position.row - activationPosition.row)
      + Math.abs(position.column - activationPosition.column) === 2
    ))).toBe(true);
    expect(activation?.affected.length).toBeGreaterThan(0);
  });

  it('tracks all four explicit objective families from transparent cascade events', () => {
    let state = createGame({
      seed: 404,
      config: {
        moves: 12,
        objectives: [
          { type: 'collect', kind: 'ember', target: 999 },
          { type: 'cascade', targetDepth: 12 },
          { type: 'formation', formation: 'line-four', target: 99 },
          { type: 'formation', formation: 'intersection', target: 99 },
          { type: 'clear-marked', target: 49 },
        ],
        markedCells: everyPosition(),
      },
    });
    for (let turn = 0; turn < 6; turn += 1) state = applyMove(state, analyzeMoves(state, 1)[0].swap);

    const cascades = state.history.flatMap((record) => record.cascades);
    const collectedEmber = cascades.reduce((total, cascade) => total + (cascade.collected.ember ?? 0), 0);
    const maxDepth = cascades.reduce((maximum, cascade) => Math.max(maximum, cascade.depth), 0);
    const lineFours = cascades.flatMap((cascade) => cascade.formations)
      .filter((formation) => formation.kind === 'line-four').length;
    const intersections = cascades.flatMap((cascade) => cascade.formations)
      .filter((formation) => formation.kind === 'intersection').length;
    const marks = cascades.reduce((total, cascade) => total + cascade.markedCleared, 0);
    expect(state.objectives.map((objective) => objective.current)).toEqual([
      collectedEmber,
      maxDepth,
      lineFours,
      intersections,
      marks,
    ]);
    expect(collectedEmber).toBeGreaterThan(0);
    expect(maxDepth).toBeGreaterThan(0);
    expect(marks).toBeGreaterThan(0);
  });

  it('recognizes wins before losses and enforces the move budget', () => {
    const winning = createGame({
      seed: 12,
      config: {
        moves: 1,
        objectives: [{ type: 'clear-marked', target: 1 }],
        markedCells: everyPosition(),
      },
    });
    const won = applyMove(winning, getValidMoves(winning)[0]);
    expect(won.movesRemaining).toBe(0);
    expect(won.status).toBe('won');
    expect(won.objectives[0].completed).toBe(true);
    expect(getValidMoves(won)).toHaveLength(0);

    const losing = createGame({
      seed: 12,
      config: {
        moves: 1,
        objectives: [{ type: 'collect', kind: 'slate', target: 999 }],
      },
    });
    const lost = applyMove(losing, getValidMoves(losing)[0]);
    expect(lost.movesRemaining).toBe(0);
    expect(lost.status).toBe('lost');
    expect(applyMove(lost, lost.history[0].swap)).toBe(lost);
  });

  it('ranks every valid move deterministically and explains the evaluation', () => {
    const state = createGame({ seed: 9_001 });
    const first = analyzeMoves(state);
    const second = analyzeMoves(state);
    expect(first).toEqual(second);
    expect(first).toHaveLength(getValidMoves(state).length);
    expect(first.every((analysis, index) => index === 0 || first[index - 1].rank >= analysis.rank)).toBe(true);
    expect(first.every((analysis) => isValidMove(state, analysis.swap))).toBe(true);
    expect(first.every((analysis) => analysis.reason.length > 8)).toBe(true);
    expect(analyzeMoves(state, 3)).toEqual(first.slice(0, 3));
    expect(forecastMove(state, first[0].swap)).toEqual(first[0]);
    expect(forecastMove(state, { from: { row: 0, column: 0 }, to: { row: 2, column: 0 } })).toBeNull();
  });

  it('exports, verifies and replays immutable turn records', () => {
    let state = createGame({
      seed: 'replay-classroom-demo',
      config: { moves: 10, objectives: [{ type: 'collect', kind: 'slate', target: 999 }] },
    });
    const initial = state;
    for (let turn = 0; turn < 5; turn += 1) state = applyMove(state, analyzeMoves(state, 1)[0].swap);

    const bundle = exportReplay(state);
    const replayed = replayGame(bundle);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(state));
    expect(replayed.history).toEqual(state.history);
    expect(stateFingerprint(replayTurns(initial, state.history))).toBe(stateFingerprint(state));
    expect(Object.isFrozen(bundle.moves)).toBe(true);

    expect(() => replayGame({
      ...bundle,
      fingerprints: bundle.fingerprints.map((fingerprint, index) => index === 2 ? '00000000' : fingerprint),
    })).toThrow(/diverged at turn 3/i);
  });

  it('provides stable daily puzzles and a varied strategic level catalogue', () => {
    expect(dailySeed('2026-07-30')).toBe(dailySeed('2026-07-30'));
    expect(dailySeed('2026-07-30')).not.toBe(dailySeed('2026-07-31'));
    expect(createDailyGame('cascade-atlas', '2026-07-30')).toEqual(
      createDailyGame('cascade-atlas', '2026-07-30'),
    );
    expect(MIND_GAME_LEVELS).toHaveLength(4);
    const objectiveTypes = new Set(MIND_GAME_LEVELS.flatMap((level) => (
      level.config.objectives.map((objective) => objective.type)
    )));
    expect(objectiveTypes).toEqual(new Set(['collect', 'clear-marked', 'cascade', 'formation']));
    expect(new Set(TILE_KINDS).size).toBe(TILE_KINDS.length);
  });
});
