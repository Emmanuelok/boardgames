/**
 * Serializable post-game summaries for the Review Hub. We distil a finished
 * game's move log into a compact record (accuracy per side, an evaluation curve,
 * the key moments) that can be persisted to localStorage and re-rendered later
 * without the live store — so a player can revisit recent games in one place.
 */
import type { EvalBand, GameDefinition, GameStatus, Player } from './types';
import type { LogEntry } from '../store/useGameStore';

const QUALITY: Record<EvalBand, number> = {
  brilliant: 1, great: 1, best: 1, good: 0.92, book: 0.84, solid: 0.84,
  inaccuracy: 0.55, mistake: 0.32, blunder: 0.06,
};
const BANDS = new Set<EvalBand>(Object.keys(QUALITY) as EvalBand[]);

export interface KeyMoment { n: number; notation: string; band: EvalBand; player: Player }

export interface GameRecord {
  id: string; ts: number;
  gameId: string; gameName: string; emoji: string; accent: string;
  result: 'win' | 'loss' | 'draw'; winner: Player | null; reason: string;
  p0: string; p1: string;            // player names
  acc: [number, number];             // accuracy %, per player
  /** Number of engine-graded moves behind each accuracy value. Optional for
   * reviews created before evidence counts were persisted. */
  graded?: [number, number];
  moves: number;
  evalPts: number[];                 // evaluation curve, tanh-scaled to [-1, 1], player-0 perspective
  key: KeyMoment[];
}

function accuracy(entries: LogEntry[]): number {
  const scored = entries.filter((e) => e.explanation);
  if (!scored.length) return 100;
  return Math.round(scored.reduce((s, e) => s + (QUALITY[e.explanation!.band] ?? 0.84), 0) / scored.length * 100);
}

/** Build a record (minus id/ts) from a finished game's log + status. */
export function summarize(def: GameDefinition, log: LogEntry[], status: GameStatus, humanColor: Player): Omit<GameRecord, 'id' | 'ts'> {
  const p0 = log.filter((e) => e.player === 0);
  const p1 = log.filter((e) => e.player === 1);
  const k = def.id === 'chess' ? 350 : 600;
  let last = 0;
  const evalPts = log.map((e) => { if (e.explanation) last = e.explanation.evalAfter; return Math.round(Math.tanh(last / k) * 100) / 100; });
  const result: GameRecord['result'] = status.kind === 'draw' ? 'draw' : (status as any).winner === humanColor ? 'win' : 'loss';
  const winner = status.kind === 'win' ? ((status as any).winner as Player) : null;
  const key: KeyMoment[] = log
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.explanation && ['blunder', 'mistake', 'brilliant', 'great'].includes(e.explanation.band))
    .slice(0, 6)
    .map(({ e, i }) => ({ n: Math.floor(i / 2) + 1, notation: e.notation, band: e.explanation!.band, player: e.player }));
  return {
    gameId: def.id, gameName: def.name, emoji: def.emoji, accent: def.accent,
    result, winner, reason: (status as any).reason ?? '',
    p0: def.players[0].name, p1: def.players[1].name,
    acc: [accuracy(p0), accuracy(p1)],
    graded: [p0.filter((entry) => entry.explanation).length, p1.filter((entry) => entry.explanation).length],
    moves: log.length, evalPts, key,
  };
}

export const REVIEW_RECORDS_STORAGE_KEY = 'gm-reviews';
export const REVIEW_RECORDS_CHANGED_EVENT = 'gm-review-records-changed';
const MAX = 40;
const CSS_HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.slice(0, max);
}

function count(value: unknown, max: number): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(max, Math.floor(parsed));
}

function pair(value: unknown, max: number): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = count(value[0], max);
  const second = count(value[1], max);
  return first === null || second === null ? null : [first, second];
}

/** Migrate one persisted review into the current safe rendering shape. */
export function normalizeGameRecord(value: unknown): GameRecord | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 128);
  const ts = count(value.ts, Number.MAX_SAFE_INTEGER);
  const gameId = text(value.gameId, 64);
  const gameName = text(value.gameName, 120);
  const p0 = text(value.p0, 80);
  const p1 = text(value.p1, 80);
  const acc = pair(value.acc, 100);
  const moves = count(value.moves, 100_000);
  const result = value.result === 'win' || value.result === 'loss' || value.result === 'draw' ? value.result : null;
  const winner = value.winner === 0 || value.winner === 1 || value.winner === null ? value.winner : null;
  if (!id || ts === null || !gameId || !gameName || !p0 || !p1 || !acc || moves === null || !result) return null;

  const evalPts = Array.isArray(value.evalPts)
    ? value.evalPts
      .filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
      .slice(0, 4096)
      .map((point) => Math.max(-1, Math.min(1, point)))
    : [];
  const key: KeyMoment[] = [];
  if (Array.isArray(value.key)) {
    for (const item of value.key) {
      if (!isRecord(item)) continue;
      const n = count(item.n, 100_000);
      const notation = text(item.notation, 256);
      const band = typeof item.band === 'string' && BANDS.has(item.band as EvalBand) ? item.band as EvalBand : null;
      const player = item.player === 0 || item.player === 1 ? item.player : null;
      if (n === null || !notation || !band || player === null) continue;
      key.push({ n, notation, band, player });
      if (key.length >= 20) break;
    }
  }

  const graded = pair(value.graded, moves);
  return {
    id,
    ts,
    gameId,
    gameName,
    emoji: typeof value.emoji === 'string' ? value.emoji.slice(0, 32) : '◇',
    accent: typeof value.accent === 'string' && CSS_HEX_COLOR.test(value.accent) ? value.accent : '#8b5cf6',
    result,
    winner: result === 'draw' ? null : winner,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '',
    p0,
    p1,
    acc,
    ...(graded ? { graded } : {}),
    moves,
    evalPts,
    key,
  };
}

export function normalizeGameRecords(value: unknown): GameRecord[] {
  if (!Array.isArray(value)) return [];
  const records: GameRecord[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const record = normalizeGameRecord(item);
    if (!record || ids.has(record.id)) continue;
    records.push(record);
    ids.add(record.id);
    if (records.length >= MAX) break;
  }
  return records;
}

export function loadRecords(): GameRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(REVIEW_RECORDS_STORAGE_KEY) || '[]');
    const records = normalizeGameRecords(raw);
    // Best-effort migration prevents every future read from revisiting bad rows.
    if (JSON.stringify(records) !== JSON.stringify(raw)) window.localStorage.setItem(REVIEW_RECORDS_STORAGE_KEY, JSON.stringify(records));
    return records;
  }
  catch { return []; }
}

export function saveRecord(rec: Omit<GameRecord, 'id' | 'ts'>): void {
  try {
    const recs = loadRecords();
    const next = normalizeGameRecord({ ...rec, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() });
    if (!next) return;
    localStorage.setItem(REVIEW_RECORDS_STORAGE_KEY, JSON.stringify(normalizeGameRecords([next, ...recs])));
    window.dispatchEvent(new Event(REVIEW_RECORDS_CHANGED_EVENT));
  } catch { /* storage unavailable — ignore */ }
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(REVIEW_RECORDS_STORAGE_KEY);
    window.dispatchEvent(new Event(REVIEW_RECORDS_CHANGED_EVENT));
  } catch { /* ignore */ }
}
