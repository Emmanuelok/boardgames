import { beforeEach, describe, expect, it } from 'vitest';
import {
  addGeneratedDrill,
  clearLabState,
  completedDrillsAsSkillEvidence,
  LAB_STORAGE_KEY,
  loadLabState,
  MAX_COMPLETED_DRILLS,
  normalizeLabState,
  recordCompletedDrill,
  removeLabAnnotation,
  upsertLabAnnotation,
} from './labStore';

describe('Intelligence Lab persistence', () => {
  beforeEach(() => localStorage.clear());

  it('normalizes unsafe rows, caps fields and keeps the newest duplicate', () => {
    const state = normalizeLabState({
      version: 99,
      annotations: [
        { id: 'note-1', reviewId: 'r1', gameId: 'chess', frameIndex: 2, note: 'old', createdAt: 1, updatedAt: 1 },
        { id: 'note-1', reviewId: 'r1', gameId: 'chess', frameIndex: 3, note: 'new', createdAt: 1, updatedAt: 2 },
        { id: 'bad', reviewId: 'r2', gameId: 'unknown', frameIndex: 0, note: 'drop', createdAt: 1 },
      ],
      generatedDrills: [{
        id: 'drill-1',
        gameId: 'hex',
        conceptId: 'connection',
        title: 'Bridge',
        prompt: 'Find the resilient connection.',
        source: 'transfer',
        href: 'javascript:alert(1)',
        createdAt: 4,
      }],
      completedDrills: [{
        id: 'done-1',
        drillId: 'drill-1',
        gameId: 'hex',
        conceptId: 'connection',
        success: true,
        attempts: 999,
        completedAt: 5,
      }],
    });
    expect(state.version).toBe(1);
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0]).toMatchObject({ note: 'new', frameIndex: 3 });
    expect(state.generatedDrills[0].href).toBe('/puzzles?game=hex&concept=connection');
    expect(state.completedDrills[0].attempts).toBe(100);
  });

  it('supports a complete annotation and drill lifecycle', () => {
    upsertLabAnnotation({
      id: 'note-1',
      reviewId: 'review-1',
      gameId: 'chess',
      frameIndex: 4,
      conceptId: 'tactics',
      note: 'I missed the defender.',
      at: 10,
    });
    upsertLabAnnotation({
      id: 'note-1',
      reviewId: 'review-1',
      gameId: 'chess',
      frameIndex: 4,
      conceptId: 'tactics',
      note: 'Check every defender first.',
      at: 20,
    });
    addGeneratedDrill({
      id: 'drill-1',
      gameId: 'chess',
      conceptId: 'tactics',
      title: 'Defender scan',
      prompt: 'Name every defender before choosing a capture.',
      source: 'review',
      sourceId: 'review-1',
      href: '/puzzles?game=chess',
      createdAt: 30,
    });
    const completed = recordCompletedDrill({
      id: 'done-1',
      drillId: 'drill-1',
      gameId: 'chess',
      conceptId: 'tactics',
      success: true,
      verification: 'engine',
      attempts: 2,
      completedAt: 40,
    });
    expect(completed.annotations).toHaveLength(1);
    expect(completed.annotations[0]).toMatchObject({
      note: 'Check every defender first.',
      createdAt: 10,
      updatedAt: 20,
    });
    expect(completed.generatedDrills).toHaveLength(1);
    expect(completedDrillsAsSkillEvidence(completed)).toEqual([{
      id: 'done-1',
      gameId: 'chess',
      conceptIds: ['tactics'],
      solved: true,
      attempts: 2,
      at: 40,
    }]);
    expect(loadLabState()).toEqual(completed);
    expect(removeLabAnnotation('note-1').annotations).toEqual([]);
    expect(clearLabState().completedDrills).toEqual([]);
    expect(localStorage.getItem(LAB_STORAGE_KEY)).toBeNull();
  });

  it('keeps self-reported practice out of Strategy DNA evidence', () => {
    const state = recordCompletedDrill({
      id: 'practice-1',
      drillId: 'drill-1',
      gameId: 'hex',
      conceptId: 'connection',
      success: true,
      verification: 'self-reported',
      attempts: 1,
      completedAt: 50,
    });
    expect(state.completedDrills[0].verification).toBe('self-reported');
    expect(completedDrillsAsSkillEvidence(state)).toEqual([]);

    const legacy = normalizeLabState({
      completedDrills: [{
        id: 'legacy',
        drillId: 'legacy-drill',
        gameId: 'chess',
        conceptId: 'tactics',
        success: true,
        attempts: 1,
        completedAt: 40,
      }],
    });
    expect(legacy.completedDrills[0].verification).toBe('self-reported');
    expect(completedDrillsAsSkillEvidence(legacy)).toEqual([]);
  });

  it('caps completion history before writing to localStorage', () => {
    const rows = Array.from({ length: MAX_COMPLETED_DRILLS + 50 }, (_, index) => ({
      id: `done-${index}`,
      drillId: `drill-${index}`,
      gameId: 'chess',
      conceptId: 'calculation',
      success: index % 2 === 0,
      attempts: 1,
      completedAt: index,
    }));
    localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify({
      version: 1,
      annotations: [],
      generatedDrills: [],
      completedDrills: rows,
    }));
    const loaded = loadLabState();
    expect(loaded.completedDrills).toHaveLength(MAX_COMPLETED_DRILLS);
    expect(loaded.completedDrills[0].id).toBe(`done-${MAX_COMPLETED_DRILLS + 49}`);
  });
});
