/**
 * Serializable post-game summaries for the Review Hub. We distil a finished
 * game's move log into a compact record (accuracy per side, an evaluation curve,
 * the key moments) that can be persisted to localStorage and re-rendered later
 * without the live store — so a player can revisit recent games in one place.
 */
import type { EvalBand, GameDefinition, GameStatus, Player } from './types';
import type { LogEntry } from '../store/useGameStore';
import { classifyPrinciples } from '../intelligence/strategyConcepts';

const QUALITY: Record<EvalBand, number> = {
  brilliant: 1, great: 1, best: 1, good: 0.92, book: 0.84, solid: 0.84,
  inaccuracy: 0.55, mistake: 0.32, blunder: 0.06,
};
const BANDS = new Set<EvalBand>(Object.keys(QUALITY) as EvalBand[]);

export interface KeyMoment {
  n: number;
  notation: string;
  band: EvalBand;
  player: Player;
  /** Optional richer evidence added by the Intelligence Lab schema. */
  summary?: string;
  principles?: string[];
  betterIdea?: string;
}

/** A bounded, read-only position in a saved post-game replay. */
export interface ReplayFrame {
  ply: number;
  player: Player | null;
  notation: string;
  /** GameDefinition.serialize(state); never evaluated as code. */
  state: string;
  band?: EvalBand;
  summary?: string;
  principles?: string[];
  betterIdea?: string;
}

export interface ReplayTimeline {
  version: 1;
  /** Original number of plies, even when the stored timeline was sampled. */
  totalPlies: number;
  sampled: boolean;
  frames: ReplayFrame[];
}

/** Aggregated, normalized teaching evidence derived from move explanations. */
export interface ConceptEvidence {
  id: string;
  label: string;
  attempts: number;
  strong: number;
  needsWork: number;
  moves: number[];
}

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
  /** Optional v2 evidence. Legacy review rows remain valid without these fields. */
  humanColor?: Player;
  replay?: ReplayTimeline;
  concepts?: ConceptEvidence[];
}

function accuracy(entries: LogEntry[]): number {
  const scored = entries.filter((e) => e.explanation);
  if (!scored.length) return 100;
  return Math.round(scored.reduce((s, e) => s + (QUALITY[e.explanation!.band] ?? 0.84), 0) / scored.length * 100);
}

function conceptEvidence(log: LogEntry[], humanColor: Player): ConceptEvidence[] {
  const evidence = new Map<string, ConceptEvidence>();
  for (const entry of log) {
    if (entry.player !== humanColor || !entry.explanation) continue;
    const explanation = entry.explanation;
    const strongMove = ['brilliant', 'great', 'best', 'good'].includes(explanation.band);
    const weakMove = ['inaccuracy', 'mistake', 'blunder'].includes(explanation.band);
    for (const concept of classifyPrinciples(explanation.principles)) {
      const current = evidence.get(concept.id) ?? {
        id: concept.id,
        label: concept.label,
        attempts: 0,
        strong: 0,
        needsWork: 0,
        moves: [],
      };
      current.attempts += 1;
      if (strongMove) current.strong += 1;
      if (weakMove) current.needsWork += 1;
      if (current.moves.length < 48) current.moves.push(entry.ply);
      evidence.set(concept.id, current);
    }
  }
  return [...evidence.values()]
    .sort((a, b) => b.attempts - a.attempts || a.label.localeCompare(b.label))
    .slice(0, 24);
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
    .map(({ e, i }) => ({
      n: Math.floor(i / 2) + 1,
      notation: e.notation,
      band: e.explanation!.band,
      player: e.player,
      ...(e.explanation!.summary ? { summary: e.explanation!.summary } : {}),
      ...(e.explanation!.principles.length ? { principles: e.explanation!.principles.slice(0, 8) } : {}),
      ...(e.explanation!.betterIdea ? { betterIdea: e.explanation!.betterIdea } : {}),
    }));
  const replay = replayFromLog(log);
  const concepts = conceptEvidence(log, humanColor);
  return {
    gameId: def.id, gameName: def.name, emoji: def.emoji, accent: def.accent,
    result, winner, reason: (status as any).reason ?? '',
    p0: def.players[0].name, p1: def.players[1].name,
    acc: [accuracy(p0), accuracy(p1)],
    graded: [p0.filter((entry) => entry.explanation).length, p1.filter((entry) => entry.explanation).length],
    moves: log.length, evalPts, key, humanColor,
    ...(replay ? { replay } : {}),
    ...(concepts.length ? { concepts } : {}),
  };
}

export const REVIEW_RECORDS_STORAGE_KEY = 'gm-reviews';
export const REVIEW_RECORDS_CHANGED_EVENT = 'gm-review-records-changed';
const MAX = 40;
export const MAX_REPLAY_FRAMES = 256;
export const MAX_REPLAY_STATE_CHARS = 24_000;
export const MAX_REPLAY_TIMELINE_CHARS = 420_000;
export const MAX_REVIEW_STORAGE_CHARS = 3_500_000;
const CSS_HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const CONCEPT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function boundedPrinciples(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const principle = text(item, 240);
    if (!principle || out.includes(principle)) continue;
    out.push(principle);
    if (out.length >= 8) break;
  }
  return out;
}

function frameFromLog(entry: LogEntry, index: number): ReplayFrame | null {
  const state = text(entry.replayStateAfter, MAX_REPLAY_STATE_CHARS);
  if (!state) return null;
  const explanation = entry.explanation;
  return {
    ply: index + 1,
    player: entry.player,
    notation: entry.notation.slice(0, 256),
    state,
    ...(explanation ? {
      band: explanation.band,
      ...(explanation.summary ? { summary: explanation.summary.slice(0, 1_000) } : {}),
      ...(explanation.principles.length ? { principles: explanation.principles.slice(0, 8).map((p) => p.slice(0, 240)) } : {}),
      ...(explanation.betterIdea ? { betterIdea: explanation.betterIdea.slice(0, 1_000) } : {}),
    } : {}),
  };
}

/** Build a bounded timeline from the standard engine store's serialized states. */
export function replayFromLog(log: LogEntry[]): ReplayTimeline | undefined {
  const initial = text(log[0]?.replayStateBefore, MAX_REPLAY_STATE_CHARS);
  if (!initial) return undefined;
  const candidates: ReplayFrame[] = [{
    ply: 0,
    player: null,
    notation: 'Initial position',
    state: initial,
  }];
  log.forEach((entry, index) => {
    const frame = frameFromLog(entry, index);
    if (frame) candidates.push(frame);
  });
  if (candidates.length < 2) return undefined;

  const averageState = Math.max(
    1,
    candidates.reduce((sum, frame) => sum + frame.state.length, 0) / candidates.length,
  );
  const limit = Math.max(
    2,
    Math.min(MAX_REPLAY_FRAMES, Math.floor(MAX_REPLAY_TIMELINE_CHARS / averageState)),
  );
  let frames = candidates;
  if (candidates.length > limit) {
    const selected = new Set<number>([0, candidates.length - 1]);
    for (let slot = 1; slot < limit - 1; slot += 1) {
      selected.add(Math.round((slot / (limit - 1)) * (candidates.length - 1)));
    }
    // Decisive moments should survive sampling whenever capacity permits.
    for (let index = 1; index < candidates.length - 1 && selected.size < limit; index += 1) {
      const band = candidates[index].band;
      if (band === 'brilliant' || band === 'great' || band === 'mistake' || band === 'blunder') {
        selected.add(index);
      }
    }
    frames = [...selected].sort((a, b) => a - b).slice(0, limit).map((index) => candidates[index]);
    if (frames[frames.length - 1] !== candidates[candidates.length - 1]) {
      frames[frames.length - 1] = candidates[candidates.length - 1];
    }
  }
  return {
    version: 1,
    totalPlies: log.length,
    sampled: frames.length !== candidates.length,
    frames,
  };
}

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

function normalizeReplayFrame(value: unknown): ReplayFrame | null {
  if (!isRecord(value)) return null;
  const ply = count(value.ply, 100_000);
  const notation = text(value.notation, 256);
  const state = text(value.state, MAX_REPLAY_STATE_CHARS);
  const player = value.player === 0 || value.player === 1 || value.player === null
    ? value.player
    : null;
  if (ply === null || !notation || !state) return null;
  const band = typeof value.band === 'string' && BANDS.has(value.band as EvalBand)
    ? value.band as EvalBand
    : undefined;
  const summary = text(value.summary, 1_000) ?? undefined;
  const betterIdea = text(value.betterIdea, 1_000) ?? undefined;
  const principles = boundedPrinciples(value.principles);
  return {
    ply,
    player,
    notation,
    state,
    ...(band ? { band } : {}),
    ...(summary ? { summary } : {}),
    ...(principles.length ? { principles } : {}),
    ...(betterIdea ? { betterIdea } : {}),
  };
}

export function normalizeReplayTimeline(value: unknown): ReplayTimeline | undefined {
  if (!isRecord(value) || !Array.isArray(value.frames)) return undefined;
  const requestedTotal = count(value.totalPlies, 100_000) ?? 0;
  const frames: ReplayFrame[] = [];
  const seen = new Set<number>();
  let stateChars = 0;
  for (const candidate of value.frames) {
    const frame = normalizeReplayFrame(candidate);
    if (!frame || seen.has(frame.ply)) continue;
    if (stateChars + frame.state.length > MAX_REPLAY_TIMELINE_CHARS) break;
    stateChars += frame.state.length;
    seen.add(frame.ply);
    frames.push(frame);
    if (frames.length >= MAX_REPLAY_FRAMES) break;
  }
  frames.sort((a, b) => a.ply - b.ply);
  if (frames.length < 2) return undefined;
  const largestPly = frames[frames.length - 1].ply;
  const totalPlies = Math.max(requestedTotal, largestPly);
  return {
    version: 1,
    totalPlies,
    sampled: value.sampled === true
      || frames.length !== value.frames.length
      || frames.some((frame, index) => index > 0 && frame.ply !== frames[index - 1].ply + 1),
    frames,
  };
}

function normalizeConceptEvidence(value: unknown): ConceptEvidence | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64)?.toLowerCase();
  const label = text(value.label, 100);
  const attempts = count(value.attempts, 100_000);
  const strong = count(value.strong, attempts ?? 100_000);
  const needsWork = count(value.needsWork, attempts ?? 100_000);
  if (!id || !CONCEPT_ID.test(id) || !label || attempts === null || strong === null || needsWork === null) return null;
  const moves = Array.isArray(value.moves)
    ? value.moves
      .map((move) => count(move, 100_000))
      .filter((move): move is number => move !== null)
      .filter((move, index, all) => all.indexOf(move) === index)
      .slice(0, 48)
    : [];
  return {
    id,
    label,
    attempts,
    strong: Math.min(attempts, strong),
    needsWork: Math.min(attempts, needsWork),
    moves,
  };
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
      const summary = text(item.summary, 1_000) ?? undefined;
      const betterIdea = text(item.betterIdea, 1_000) ?? undefined;
      const principles = boundedPrinciples(item.principles);
      key.push({
        n,
        notation,
        band,
        player,
        ...(summary ? { summary } : {}),
        ...(principles.length ? { principles } : {}),
        ...(betterIdea ? { betterIdea } : {}),
      });
      if (key.length >= 20) break;
    }
  }

  const graded = pair(value.graded, moves);
  const humanColor = value.humanColor === 0 || value.humanColor === 1 ? value.humanColor : undefined;
  const replay = normalizeReplayTimeline(value.replay);
  const concepts = Array.isArray(value.concepts)
    ? value.concepts
      .map(normalizeConceptEvidence)
      .filter((concept): concept is ConceptEvidence => concept !== null)
      .filter((concept, index, all) => all.findIndex((candidate) => candidate.id === concept.id) === index)
      .slice(0, 24)
    : [];
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
    ...(humanColor !== undefined ? { humanColor } : {}),
    ...(replay ? { replay } : {}),
    ...(concepts.length ? { concepts } : {}),
  };
}

export function normalizeGameRecords(value: unknown): GameRecord[] {
  if (!Array.isArray(value)) return [];
  const records: GameRecord[] = [];
  const ids = new Set<string>();
  let storageChars = 0;
  for (const item of value) {
    let record = normalizeGameRecord(item);
    if (!record || ids.has(record.id)) continue;
    let encoded = JSON.stringify(record);
    if (storageChars + encoded.length > MAX_REVIEW_STORAGE_CHARS && record.replay) {
      // Preserve the durable summary/evidence even when old replay snapshots no
      // longer fit inside the browser's conservative storage budget.
      const { replay: _replay, ...summaryOnly } = record;
      record = summaryOnly;
      encoded = JSON.stringify(record);
    }
    if (storageChars + encoded.length > MAX_REVIEW_STORAGE_CHARS) continue;
    records.push(record);
    ids.add(record.id);
    storageChars += encoded.length;
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
