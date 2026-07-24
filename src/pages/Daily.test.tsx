import { beforeEach, describe, expect, it } from 'vitest';
import { loadDailyStore, normalizeDailyStore } from './Daily';

describe('Daily persistence', () => {
  beforeEach(() => localStorage.clear());

  it('preserves a valid streak history', () => {
    expect(normalizeDailyStore({
      lastDate: '2026-07-22',
      streak: 7,
      best: 12,
      total: 40,
      days: ['2026-07-21', '2026-07-22'],
    })).toEqual({
      lastDate: '2026-07-22',
      streak: 7,
      best: 12,
      total: 40,
      days: ['2026-07-21', '2026-07-22'],
    });
  });

  it('repairs malformed dates, arrays, and unbounded counters', () => {
    expect(normalizeDailyStore({
      lastDate: '2026-02-30',
      streak: Number.POSITIVE_INFINITY,
      best: -2,
      total: Number.MAX_VALUE,
      days: [null, 'bad', '2026-07-21', '2026-07-21', '2026-07-22'],
    })).toEqual({
      lastDate: '',
      streak: 0,
      best: 0,
      total: 1_000_000,
      days: ['2026-07-21', '2026-07-22'],
    });
  });

  it('cannot return a non-array days field from localStorage', () => {
    localStorage.setItem('gm-daily', '{"lastDate":"2026-07-22","streak":4,"best":5,"total":9,"days":null}');
    expect(loadDailyStore()).toEqual({
      lastDate: '2026-07-22',
      streak: 4,
      best: 5,
      total: 9,
      days: [],
    });
  });

  it('falls back safely when persisted JSON is corrupt', () => {
    localStorage.setItem('gm-daily', '{not-json');
    expect(loadDailyStore()).toEqual({ lastDate: '', streak: 0, best: 0, total: 0, days: [] });
  });
});
