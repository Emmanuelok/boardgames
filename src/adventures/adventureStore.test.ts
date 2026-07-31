import { beforeEach, describe, expect, it } from 'vitest';
import { chapterUnlocked, normalizeAdventureData, useAdventureStore } from './adventureStore';

describe('adventure progress', () => {
  beforeEach(() => {
    localStorage.clear();
    useAdventureStore.getState().reset();
  });

  it('unlocks chapters in deterministic order', () => {
    const initial = useAdventureStore.getState();
    expect(chapterUnlocked(initial, 'threads-of-territory', 'bridge-the-hex')).toBe(true);
    expect(chapterUnlocked(initial, 'threads-of-territory', 'shape-the-influence')).toBe(false);
    expect(initial.complete('threads-of-territory', 'bridge-the-hex')).toBe(true);
    expect(chapterUnlocked(useAdventureStore.getState(), 'threads-of-territory', 'shape-the-influence')).toBe(true);
    expect(useAdventureStore.getState().complete('threads-of-territory', 'bridge-the-hex')).toBe(false);
  });

  it('drops unknown and duplicate persisted chapter ids', () => {
    const data = normalizeAdventureData({
      completed: {
        'tempo-atlas': ['wake-the-pieces', 'wake-the-pieces', 'not-real'],
        invented: ['anything'],
      },
      active: { adventureId: 'invented', chapterId: 'anything', missionId: 'x' },
    });
    expect(data.completed['tempo-atlas']).toEqual(['wake-the-pieces']);
    expect(data.active).toBeNull();
  });
});
