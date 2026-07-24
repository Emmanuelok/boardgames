import { describe, expect, it } from 'vitest';
import { readMissionContext, withMissionContext } from './missionRouting';

describe('mission routing', () => {
  it('adds mission context while preserving an existing game filter', () => {
    expect(withMissionContext('/puzzles?game=hex', 'mission 1', 'practice'))
      .toBe('/puzzles?game=hex&mission=mission+1&stage=practice');
  });

  it('replaces stale mission values rather than duplicating them', () => {
    expect(withMissionContext('/play/chess?mission=old&stage=learn', 'new', 'play'))
      .toBe('/play/chess?mission=new&stage=play');
  });

  it('accepts only bounded, known context values', () => {
    expect(readMissionContext(new URLSearchParams('mission=m1&stage=reflect')))
      .toEqual({ missionId: 'm1', stage: 'reflect' });
    expect(readMissionContext(new URLSearchParams('mission=m1&stage=unknown'))).toBeNull();
    expect(readMissionContext(new URLSearchParams(`mission=${'x'.repeat(257)}&stage=play`))).toBeNull();
  });
});
