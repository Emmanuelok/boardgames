import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRecords,
  normalizeGameRecord,
  normalizeGameRecords,
  normalizeReplayTimeline,
  replayFromLog,
  REVIEW_RECORDS_CHANGED_EVENT,
  saveRecord,
  summarize,
  type GameRecord,
} from './reviewSummary';
import type { LogEntry } from '../store/useGameStore';
import type { GameDefinition } from './types';

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

  it('builds a scrub-safe replay timeline from serialized standard-game positions', () => {
    const log: LogEntry[] = [
      {
        ply: 1,
        player: 0,
        notation: 'e4',
        replayStateBefore: 'start',
        replayStateAfter: 'after-e4',
        explanation: {
          summary: 'Claims central space.',
          band: 'good',
          evalBefore: 0,
          evalAfter: 18,
          insights: [],
          principles: ['Control the centre.'],
        },
      },
      {
        ply: 2,
        player: 1,
        notation: 'e5',
        replayStateBefore: 'after-e4',
        replayStateAfter: 'after-e5',
      },
    ];

    expect(replayFromLog(log)).toEqual({
      version: 1,
      totalPlies: 2,
      sampled: false,
      frames: [
        { ply: 0, player: null, notation: 'Initial position', state: 'start' },
        {
          ply: 1,
          player: 0,
          notation: 'e4',
          state: 'after-e4',
          band: 'good',
          summary: 'Claims central space.',
          principles: ['Control the centre.'],
        },
        { ply: 2, player: 1, notation: 'e5', state: 'after-e5' },
      ],
    });

    const def = {
      id: 'chess',
      name: 'Chess',
      emoji: '♟',
      accent: '#7c3aed',
      players: [{ name: 'White' }, { name: 'Black' }],
    } as GameDefinition;
    const summary = summarize(def, log, { kind: 'draw', reason: 'test' }, 0);
    expect(summary.concepts).toEqual([
      {
        id: 'space-control',
        label: 'Space control',
        attempts: 1,
        strong: 1,
        needsWork: 0,
        moves: [1],
      },
    ]);
  });

  it('bounds and repairs optional replay and concept evidence without rejecting legacy summaries', () => {
    const replay = normalizeReplayTimeline({
      version: 99,
      totalPlies: 3,
      sampled: false,
      frames: [
        { ply: 0, player: null, notation: 'Initial', state: 's0' },
        { ply: 1, player: 0, notation: 'a1', state: 's1', principles: ['Plan', '', 42] },
        { ply: 1, player: 0, notation: 'duplicate', state: 'bad' },
        { ply: 3, player: 'admin', notation: 'a3', state: 's3', band: 'blunder' },
      ],
    });
    expect(replay).toMatchObject({
      version: 1,
      totalPlies: 3,
      sampled: true,
      frames: [
        { ply: 0, player: null, state: 's0' },
        { ply: 1, player: 0, state: 's1', principles: ['Plan'] },
        { ply: 3, player: null, state: 's3', band: 'blunder' },
      ],
    });

    const repaired = normalizeGameRecord({
      ...valid,
      humanColor: 0,
      replay,
      concepts: [
        { id: 'tempo', label: 'Tempo', attempts: 4, strong: 99, needsWork: 2, moves: [1, 1, 3, 'bad'] },
        { id: '<script>', label: 'Unsafe', attempts: 1, strong: 1, needsWork: 0 },
      ],
    });
    expect(repaired?.humanColor).toBe(0);
    expect(repaired?.replay?.frames).toHaveLength(3);
    expect(repaired?.concepts).toEqual([
      { id: 'tempo', label: 'Tempo', attempts: 4, strong: 4, needsWork: 2, moves: [1, 3] },
    ]);
  });
});
