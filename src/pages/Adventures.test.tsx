import { describe, expect, it } from 'vitest';
import { shouldConfirmAdventureReplacement } from './Adventures';

const activeMission = { id: 'mission-current', status: 'active' as const };
const activeAdventure = {
  adventureId: 'shape-of-connection',
  chapterId: 'bridges',
  missionId: 'mission-current',
  startedAt: 10,
};

describe('adventure replacement confirmation', () => {
  it('does not interrupt a request for the already-active chapter', () => {
    expect(shouldConfirmAdventureReplacement(activeMission, activeAdventure, {
      adventureId: 'shape-of-connection',
      chapterId: 'bridges',
    })).toBe(false);
  });

  it('confirms when the requested chapter differs from the active chapter', () => {
    expect(shouldConfirmAdventureReplacement(activeMission, activeAdventure, {
      adventureId: 'shape-of-connection',
      chapterId: 'influence',
    })).toBe(true);
    expect(shouldConfirmAdventureReplacement(activeMission, activeAdventure, {
      adventureId: 'tempo-trail',
      chapterId: 'initiative',
    })).toBe(true);
  });

  it('confirms for an active mission whose adventure link is missing or stale', () => {
    expect(shouldConfirmAdventureReplacement(activeMission, null, {
      adventureId: 'shape-of-connection',
      chapterId: 'bridges',
    })).toBe(true);
    expect(shouldConfirmAdventureReplacement(
      activeMission,
      { ...activeAdventure, missionId: 'stale-mission' },
      { adventureId: 'shape-of-connection', chapterId: 'bridges' },
    )).toBe(true);
  });

  it('never confirms after the current mission is complete', () => {
    expect(shouldConfirmAdventureReplacement(
      { ...activeMission, status: 'complete' },
      activeAdventure,
      { adventureId: 'tempo-trail', chapterId: 'initiative' },
    )).toBe(false);
  });
});
