import { describe, expect, it } from 'vitest';
import {
  createDraft,
  exportCreation,
  importCreation,
  legalMoveOptions,
  normalizeCreatorData,
  validateCreation,
} from './creations';

describe('creator studio data', () => {
  it('round-trips a bounded creation share code', () => {
    const draft = createDraft('puzzle-pack', 'tic-tac-toe');
    const solution = legalMoveOptions(draft)[0];
    const ready = { ...draft, title: 'Opening square', description: 'Choose a strong first placement.', prompt: 'Find a useful opening square.', solutions: [solution] };
    const imported = importCreation(exportCreation(ready));
    expect(imported.title).toBe(ready.title);
    expect(imported.gameId).toBe('tic-tac-toe');
    expect(imported.status).toBe('draft');
    expect(imported.id).not.toBe(ready.id);
  });

  it('requires publication validation before exporting a share code', () => {
    const incomplete = {
      ...createDraft('puzzle-pack', 'chess'),
      title: 'Pinned piece',
      description: 'Find the strongest legal continuation.',
      prompt: 'Choose the move that uses the pin.',
      solutions: ['not-a-move'],
    };
    expect(() => exportCreation(incomplete)).toThrow(/legal in the saved position/i);

    const brokenPosition = { ...incomplete, setup: '{broken', solutions: [] };
    expect(() => exportCreation(brokenPosition)).toThrow(/position cannot be opened/i);
  });

  it('preserves authored Hint 1 and Hint 2 positions through sharing', () => {
    const draft = createDraft('puzzle-pack', 'tic-tac-toe');
    const ready = {
      ...draft,
      title: 'Opening square',
      description: 'Choose a strong first placement.',
      prompt: 'Find a useful opening square.',
      solutions: [legalMoveOptions(draft)[0]],
      hints: ['', 'Look at the centre.'],
    };
    expect(importCreation(exportCreation(ready)).hints).toEqual(['', 'Look at the centre.']);
  });

  it('rejects illegal puzzle solutions and incomplete courses', () => {
    const puzzle = { ...createDraft('puzzle-pack', 'chess'), title: 'Test puzzle', description: 'A complete testing description.', prompt: 'Find the best legal move.', solutions: ['not-a-move'] };
    expect(validateCreation(puzzle)).toContain('Every accepted move must be legal in the saved position.');
    const course = { ...createDraft('guided-course', 'hex'), title: 'Hex basics', description: 'A guided introduction to connection.', steps: [] };
    expect(validateCreation(course)).toContain('A guided course needs at least two complete steps.');
  });

  it('drops unsupported engines and duplicate ids from storage', () => {
    const valid = createDraft('guided-course', 'chess');
    const normalized = normalizeCreatorData({ creations: [valid, valid, { ...valid, id: 'bad', gameId: 'unknown' }] });
    expect(normalized.creations).toHaveLength(1);
  });
});
