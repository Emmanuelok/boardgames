import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRecords,
  normalizeGameRecord,
  normalizeGameRecords,
  REVIEW_RECORDS_CHANGED_EVENT,
  saveRecord,
  type GameRecord,
} from './reviewSummary';

const valid: GameRecord = {
  id: 'review-1',
  ts: 1_700_000_000_000,
  gameId: 'chess',
  gameName: 'Chess',
  emoji: '♟',
  accent: '#7c3aed',
  result: 'loss',
  winner: 1,
  reason: 'checkmate',
  p0: 'White',
  p1: 'Black',
  acc: [72, 89],
  moves: 18,
  evalPts: [0, -0.2, -1],
  key: [{ n: 7, notation: 'Qh5', band: 'mistake', player: 0 }],
};

describe('review persistence normalization', () => {
  beforeEach(() => localStorage.clear());

  it('preserves a valid legacy record without graded evidence counts', () => {
    expect(normalizeGameRecord(valid)).toEqual(valid);
  });

  it('drops malformed rows and repairs unsafe nested values', () => {
    const repaired = normalizeGameRecord({
      ...valid,
      acc: [0, 150],
      accent: 'url(https://example.test/tracker)',
      evalPts: [0, Number.POSITIVE_INFINITY, 4],
      key: [
        null,
        valid.key[0],
        { n: 8, notation: 'bad', band: 'administrator', player: 0 },
      ],
      graded: [5, Number.NaN],
    });

    expect(repaired).toMatchObject({ accent: '#8b5cf6', acc: [0, 100], evalPts: [0, 1], key: valid.key });
    expect(repaired?.graded).toBeUndefined();
    expect(normalizeGameRecords([null, {}, valid, valid])).toEqual([valid]);
  });

  it('migrates localStorage so consumers never receive null records', () => {
    localStorage.setItem('gm-reviews', JSON.stringify([null, valid, { id: 'broken' }]));
    expect(loadRecords()).toEqual([valid]);
    expect(JSON.parse(localStorage.getItem('gm-reviews')!)).toEqual([valid]);
  });

  it('saves a normalized record and retains the existing history', () => {
    let changeEvents = 0;
    const onChange = () => { changeEvents += 1; };
    window.addEventListener(REVIEW_RECORDS_CHANGED_EVENT, onChange);
    localStorage.setItem('gm-reviews', JSON.stringify([valid]));
    const { id: _id, ts: _ts, ...summary } = valid;
    saveRecord({ ...summary, gameId: 'go', gameName: 'Go' });
    window.removeEventListener(REVIEW_RECORDS_CHANGED_EVENT, onChange);
    const records = loadRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ gameId: 'go', gameName: 'Go' });
    expect(records[1]).toEqual(valid);
    expect(changeEvents).toBe(1);
  });
});
