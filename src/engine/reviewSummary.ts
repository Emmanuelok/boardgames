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

export interface KeyMoment { n: number; notation: string; band: EvalBand; player: Player }

export interface GameRecord {
  id: string; ts: number;
  gameId: string; gameName: string; emoji: string; accent: string;
  result: 'win' | 'loss' | 'draw'; winner: Player | null; reason: string;
  p0: string; p1: string;            // player names
  acc: [number, number];             // accuracy %, per player
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
    acc: [accuracy(p0), accuracy(p1)], moves: log.length, evalPts, key,
  };
}

const KEY = 'gm-reviews';
const MAX = 40;

export function loadRecords(): GameRecord[] {
  try { const r = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(r) ? r : []; }
  catch { return []; }
}

export function saveRecord(rec: Omit<GameRecord, 'id' | 'ts'>): void {
  try {
    const recs = loadRecords();
    recs.unshift({ ...rec, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(recs.slice(0, MAX)));
  } catch { /* storage unavailable — ignore */ }
}

export function clearRecords(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
