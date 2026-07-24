import { describe, expect, it } from 'vitest';
import {
  isLocalDateKey,
  localDateAtOffset,
  localDateKey,
  localDateKeyAtOffset,
  parseLocalDateKey,
} from './localDate';

describe('local calendar dates', () => {
  it('moves by calendar days without assuming every day has 24 hours', () => {
    const mondayAfterSpringChange = new Date(2026, 2, 9, 0, 30);
    expect(localDateKeyAtOffset(mondayAfterSpringChange, -1)).toBe('2026-03-08');
    expect(localDateKey(localDateAtOffset(mondayAfterSpringChange, -6))).toBe('2026-03-03');
  });

  it('parses date-only keys in local time and round-trips them', () => {
    const parsed = parseLocalDateKey('2026-07-22');
    expect(parsed).not.toBeNull();
    expect(localDateKey(parsed!)).toBe('2026-07-22');
    expect(parsed!.getHours()).toBe(12);
  });

  it('rejects impossible or malformed calendar keys', () => {
    expect(isLocalDateKey('2026-02-28')).toBe(true);
    expect(isLocalDateKey('2026-02-30')).toBe(false);
    expect(parseLocalDateKey('July 22, 2026')).toBeNull();
  });
});
